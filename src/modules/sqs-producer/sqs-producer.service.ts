import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Producer } from 'sqs-producer';
import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { Message, SqsProducerHandler } from './sqs-producer.types';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NFTCollectionTaskService } from '../nft-collection-task/nft-collection-task.service';
import { NFTCollectionService } from '../nft-collection/nft-collection.service';
import { EthereumService } from '../ethereum/ethereum.service';
import {
  QueueMessageBody,
  TaskPerBlock,
} from '../nft-collection-task/dto/create-nft-collection-task.dto';
import R from 'ramda';
import { Utils } from 'src/utils';

@Injectable()
export class SqsProducerService implements OnModuleInit, SqsProducerHandler {
  public sqsProducer: Producer;
  private readonly logger = new Logger(SqsProducerService.name);
  private readonly blockInterval: number;
  private readonly messageNum: number;
  private readonly stopSendBlock: number;
  private readonly isVip: boolean = false;
  private isProcessing: boolean = false;
  private skippingCounter: number = 0;
  private readonly queryLimit: number;
  private readonly source: string;

  constructor(
    private configService: ConfigService,
    private readonly nftCollectionTaskService: NFTCollectionTaskService,
    private readonly nftCollectionService: NFTCollectionService,
    private readonly ethereumService: EthereumService,
  ) {
    AWS.config.update({
      region: this.configService.get('aws.region') || 'us-east-1',
      accessKeyId: this.configService.get('aws.accessKeyId') || '',
      secretAccessKey: this.configService.get('aws.secretAccessKey') || '',
    });
    this.blockInterval = this.configService.get('queue_config.block_interval');
    this.messageNum = this.configService.get('queue_config.message_num');
    this.stopSendBlock = this.configService.get('queue_config.end_block');
    this.queryLimit = Number(this.configService.get('query_limit')) || 1;
    this.source = this.configService.get('source');

    if (this.source !== 'ARCHIVE' && this.source !== 'MONITOR') {
      throw new Error(`SOURCE has invalid value(${this.source})`);
    }

    const queueUrl = this.configService.get('aws.queueUrl');
    if (queueUrl.includes('-vip')) {
      this.isVip = true;
    }
  }

  public onModuleInit() {
    this.sqsProducer = Producer.create({
      queueUrl: this.configService.get('aws.queueUrl'),
      sqs: new AWS.SQS(),
    });
  }

  /**
   * #1. check if there is any collection not finished yet (lastProcessedBlock < currentBlock)
   * #2. split to tasks and send to queue
   * #3. save tasks to DB
   * #4. mark collection as processed
   */
  @Cron('*/2 * * * * *')
  public async checkForwardCollection() {
    if (this.source.toLowerCase() !== 'monitor') {
      return;
    }

    if (this.isProcessing) {
      // Forward flow
      if (
        this.skippingCounter <
        Number(this.configService.get('skippingCounterLimit'))
      ) {
        this.skippingCounter++;
        this.logger.log(
          `[CRON Transfer Task] Task is in process, skipping (${this.skippingCounter}) ...`,
        );
      } else {
        // when the counter reaches the limit, restart the pod.
        this.logger.log(
          `[CRON Transfer Task] Task skipping counter reached its limit. The process is not responsive, restarting...`,
        );
        Utils.shutdown();
      }

      return;
    }

    this.isProcessing = true;

    // Check if there is any unprocessed collection
    let finalEndBlock =
      this.stopSendBlock ?? (await this.ethereumService.getBlockNum());

    const unprocessed =
      await this.nftCollectionService.findUnfinishedForwardFlow(
        finalEndBlock,
        this.isVip,
        this.queryLimit,
      );

    if (!unprocessed || unprocessed.length === 0) {
      this.logger.log(
        "[CRON Task] Didn't find unprocessed blocks. Skipping iteration",
      );
      this.isProcessing = false;
      return;
    }
    this.logger.log(
      `[Media Producer] Got ${unprocessed.length} to process || Query limit: ${this.queryLimit}`,
    );

    const processed = [];

    await this.nftCollectionService.markAsProcessingForward(unprocessed);

    for (const unprocessedCollection of unprocessed) {
      this.logger.log(
        `[CRON Collection ${unprocessedCollection.contractAddress}] Find Unfinished collection. Already processed to ${unprocessedCollection.lastProcessedBlock}. Current configured end block: ${finalEndBlock}`,
      );

      // check if got target block
      if (unprocessedCollection.targetBlock) {
        finalEndBlock = unprocessedCollection.targetBlock;
      }

      // Prepare tasks
      const startBlock = R.is(Number, unprocessedCollection.lastProcessedBlock)
        ? unprocessedCollection.lastProcessedBlock + 1
        : unprocessedCollection.createdAtBlock;
      let endBlock = startBlock + this.blockInterval * this.messageNum;
      endBlock = endBlock >= finalEndBlock ? finalEndBlock : endBlock;
      const tasks = this.eventlySpaceByStep(
        unprocessedCollection.contractAddress,
        unprocessedCollection.tokenType,
        startBlock,
        endBlock,
        this.blockInterval,
      );
      this.logger.log(
        `[CRON Collection ${unprocessedCollection.contractAddress}] Generated ${tasks.length} tasks between block [${startBlock} - ${endBlock}] with block interval ${this.blockInterval}`,
      );

      // Prepare queue messages and sent as batch
      if (tasks.length > 0) {
        const messages: Message<QueueMessageBody>[] = tasks.map((task) => {
          const id = `${unprocessedCollection.contractAddress}-${task.startBlock}-${task.endBlock}`;
          return {
            id,
            body: task,
            groupId: uuidv4(),
            deduplicationId: id,
          };
        });
        const queueResults = await this.sendMessage(messages);

        processed.push({
          contractAddress: unprocessedCollection.contractAddress,
          firstProcessedBlock: unprocessedCollection.createdAtBlock,
          lastProcessedBlock: endBlock,
          isFinished: endBlock === finalEndBlock,
        });

        this.logger.log(
          `[CRON Collection ${unprocessedCollection.contractAddress}] Successfully sent ${queueResults.length} messages for collection`,
        );
      }
    }

    // Mark this collection
    await this.nftCollectionService.markAsProcessedForwardFlow(processed);

    // this.logger.log(
    //   `[CRON Collection ${unprocessedCollection.contractAddress}] Successfully processed collection to block ${endBlock}`,
    // );
    this.isProcessing = false;
    this.skippingCounter = 0;
  }

  /**
   * #1. check if there is any collection not finished yet (lastProcessedBlock < currentBlock)
   * #2. split to tasks and send to queue
   * #3. save tasks to DB
   * #4. mark collection as processed
   */
  @Cron('*/2 * * * * *')
  public async checkBackwardCollection() {
    if (this.source.toLowerCase() !== 'archive') {
      return;
    }

    // Forward flow
    if (this.isProcessing) {
      if (
        this.skippingCounter <
        Number(this.configService.get('skippingCounterLimit'))
      ) {
        this.skippingCounter++;
        this.logger.log(
          `[CRON Transfer Task] Task is in process, skipping (${this.skippingCounter}) ...`,
        );
      } else {
        // when the counter reaches the limit, restart the pod.
        this.logger.log(
          `[CRON Transfer Task] Task skipping counter reached its limit. The process is not responsive, restarting...`,
        );
        Utils.shutdown();
      }

      return;
    }

    this.isProcessing = true;

    let finalEndBlock = this.stopSendBlock;

    const unprocessed =
      await this.nftCollectionService.findUnfinishedBackwardFlow(
        finalEndBlock,
        this.isVip,
        this.queryLimit,
      );

    if (!unprocessed || unprocessed.length === 0) {
      this.logger.log(
        "[CRON Task] Didn't find unprocessed blocks. Skipping iteration",
      );
      this.isProcessing = false;
      return;
    }
    this.logger.log(
      `[Media Producer] Got ${unprocessed.length} to process || Query limit: ${this.queryLimit}`,
    );

    const processed = [];

    await this.nftCollectionService.markAsProcessingBackward(unprocessed);

    for (const unprocessedCollection of unprocessed) {
      this.logger.log(
        `[CRON Collection ${unprocessedCollection.contractAddress}] Find Unfinished collection. Already processed to ${unprocessedCollection.firstProcessedBlock}. Current configured end block: ${finalEndBlock}`,
      );

      // Prepare tasks
      const startBlock = R.is(Number, unprocessedCollection.firstProcessedBlock)
        ? unprocessedCollection.firstProcessedBlock - 1
        : unprocessedCollection.createdAtBlock;
      let endBlock = startBlock - this.blockInterval * this.messageNum;
      endBlock = endBlock <= finalEndBlock ? finalEndBlock : endBlock;
      const tasks = this.eventlySpaceByStep(
        unprocessedCollection.contractAddress,
        unprocessedCollection.tokenType,
        endBlock,
        startBlock,
        this.blockInterval,
      );
      this.logger.log(
        `[CRON Collection ${unprocessedCollection.contractAddress}] Generated ${tasks.length} tasks between block [${endBlock} - ${startBlock}] with block interval ${this.blockInterval}`,
      );

      // Prepare queue messages and sent as batch
      if (tasks.length > 0) {
        const messages: Message<QueueMessageBody>[] = tasks.map((task) => {
          const id = `${unprocessedCollection.contractAddress}-${task.endBlock}-${task.startBlock}`;
          return {
            id,
            body: task,
            groupId: uuidv4(),
            deduplicationId: id,
          };
        });
        const queueResults = await this.sendMessage(messages);

        processed.push({
          contractAddress: unprocessedCollection.contractAddress,
          firstProcessedBlock: unprocessedCollection.createdAtBlock,
          lastProcessedBlock: endBlock,
          isFinished: endBlock === finalEndBlock,
        });

        this.logger.log(
          `[CRON Collection ${unprocessedCollection.contractAddress}] Successfully sent ${queueResults.length} messages for collection`,
        );
      }
    }

    // Mark this collection
    await this.nftCollectionService.markAsProcessedBackwardFlow(processed);

    this.isProcessing = false;
    this.skippingCounter = 0;
  }

  /**
   * [Only for VIP] Reset isProcessing to false for expired collections
   * #1. find all expired sendings
   * TODO: consider to remove the isProcessing flag
   */
  @Cron(new Date(Date.now() + 10 * 1000))
  public async resetIsprocessing() {
    if (this.source.toLowerCase() !== 'monitor') {
      return;
    }

    const expiredAddresses =
      await this.nftCollectionService.findExpiredOnesForward();
    if (!expiredAddresses || expiredAddresses.length === 0) {
      return;
    }

    this.logger.log(
      `[CRON Rest] Reset isProcessing for ${expiredAddresses.length} collections`,
    );
    await this.nftCollectionService.resetExpiredOnesForward(expiredAddresses);
  }

  /**
   * [Only for VIP] Reset isProcessing to false for expired collections
   * #1. find all expired sendings
   * TODO: consider to remove the isProcessing flag
   */
  @Cron(new Date(Date.now() + 10 * 1000))
  public async resetIsprocessingBackward() {
    if (this.source.toLowerCase() !== 'archive') {
      return;
    }

    const expiredAddresses =
      await this.nftCollectionService.findExpiredOnesBackward();
    if (!expiredAddresses || expiredAddresses.length === 0) {
      return;
    }

    this.logger.log(
      `[CRON Rest] Reset isProcessing for ${expiredAddresses.length} collections`,
    );
    await this.nftCollectionService.resetExpiredOnesBackward(expiredAddresses);
  }

  /**
   * #1. check if there is any task need to be splited
   * #2. split to 2 tasks and send to queue
   * #3. save 2 new tasks to DB
   * #4. delete task as processed
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  public async checkCollectionTaskForward() {
    if (this.source.toLowerCase() !== 'monitor') {
      return;
    }

    // Check if there is any unprocessed collection
    const unprocessed =
      await this.nftCollectionTaskService.findSplitOneForward();
    if (!unprocessed) {
      this.logger.log(
        "[CRON Task] Didn't find blocks for splitting. Skipping iteration",
      );

      return;
    }
    this.logger.log(
      `[CRON Task] Find one task need to be splited: ${unprocessed.contractAddress} from block ${unprocessed.startBlock} to ${unprocessed.endBlock}`,
    );

    const isSingleTask =
      unprocessed.startBlock === unprocessed.endBlock ||
      unprocessed.endBlock - unprocessed.startBlock === 1;
    // Prepare tasks

    const tasks = this.eventlySpaceByCardinality(
      unprocessed.contractAddress,
      unprocessed.tokenType,
      unprocessed.startBlock,
      unprocessed.endBlock,
      isSingleTask ? 1 : 2,
    );

    // Prepare queue messages and sent as batch
    const messages: Message<QueueMessageBody>[] = tasks.map((task) => {
      const id = `${unprocessed.contractAddress}-${task.startBlock}-${task.endBlock}`;
      return {
        id,
        body: task,
        groupId: uuidv4(),
        deduplicationId: id,
      };
    });

    const queueResults = await this.sendMessage(messages);
    this.logger.log(
      `[CRON Task] Successfully sent ${queueResults.length} messages for collection ${unprocessed.contractAddress}`,
    );

    // Mark this collection
    await this.nftCollectionTaskService.deleteOne(unprocessed.messageId);
    this.logger.log(
      `[CRON Task] Successfully deleted task ${unprocessed.contractAddress} from block ${unprocessed.startBlock} to ${unprocessed.endBlock}`,
    );
  }

  /**
   * #1. check if there is any task need to be splited
   * #2. split to 2 tasks and send to queue
   * #3. save 2 new tasks to DB
   * #4. delete task as processed
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  public async checkCollectionTaskBackward() {
    if (this.source.toLowerCase() !== 'archive') {
      return;
    }

    // Check if there is any unprocessed collection
    const unprocessed =
      await this.nftCollectionTaskService.findSplitOneBackward();
    if (!unprocessed) {
      this.logger.log(
        "[CRON Task] Didn't find blocks for splitting. Skipping iteration",
      );

      return;
    }
    this.logger.log(
      `[CRON Task] Find one task need to be splited: ${unprocessed.contractAddress} from block ${unprocessed.startBlock} to ${unprocessed.endBlock}`,
    );

    const isSingleTask =
      unprocessed.startBlock === unprocessed.endBlock ||
      unprocessed.endBlock - unprocessed.startBlock === 1;
    // Prepare tasks

    const tasks = this.eventlySpaceByCardinality(
      unprocessed.contractAddress,
      unprocessed.tokenType,
      unprocessed.endBlock,
      unprocessed.startBlock,
      isSingleTask ? 1 : 2,
    );

    // Prepare queue messages and sent as batch
    const messages: Message<QueueMessageBody>[] = tasks.map((task) => {
      const id = `${unprocessed.contractAddress}-${task.endBlock}-${task.startBlock}`;
      return {
        id,
        body: task,
        groupId: uuidv4(),
        deduplicationId: id,
      };
    });

    const queueResults = await this.sendMessage(messages);
    this.logger.log(
      `[CRON Task] Successfully sent ${queueResults.length} messages for collection ${unprocessed.contractAddress}`,
    );

    // Mark this collection
    await this.nftCollectionTaskService.deleteOne(unprocessed.messageId);
    this.logger.log(
      `[CRON Task] Successfully deleted task ${unprocessed.contractAddress} from block ${unprocessed.startBlock} to ${unprocessed.endBlock}`,
    );
  }

  private splitToTasks(startBlock: number, endBlock: number, interval = 1000) {
    const tasks: TaskPerBlock[] = [];
    for (let i = startBlock; i <= endBlock; i = i + interval + 1) {
      const endNum = i + interval;
      tasks.push({
        startBlock: i,
        endBlock: endNum >= endBlock ? endBlock : endNum,
      });
    }
    return tasks;
  }

  private eventlySpaceByStep(
    address: string,
    type: string,
    startBlock: number,
    endBlock: number,
    step = 10,
  ) {
    const tasks: QueueMessageBody[] = [];
    const cardinality = Math.round((endBlock - startBlock) / step);
    if (cardinality <= 0) {
      tasks.push({
        startBlock,
        endBlock,
        tokenType: type,
        contractAddress: address,
      });
      return tasks;
    }
    for (let i = 0; i < cardinality; i++) {
      const endNum = startBlock + (i + 1) * step;
      const startNum = startBlock + i * step;
      tasks.push({
        startBlock: i === 0 ? startNum : startNum + 1,
        endBlock: endNum >= endBlock ? endBlock : endNum,
        tokenType: type,
        contractAddress: address,
      });
    }
    return tasks;
  }

  private eventlySpaceByCardinality(
    address: string,
    type: string,
    startBlock: number,
    endBlock: number,
    cardinality = 10,
  ) {
    const tasks: QueueMessageBody[] = [];
    const step = Math.round((endBlock - startBlock) / cardinality);
    for (let i = 0; i < cardinality; i++) {
      const endNum = startBlock + (i + 1) * step;
      const startNum = startBlock + i * step;
      tasks.push({
        startBlock: i === 0 ? startNum : startNum + 1,
        endBlock: endNum >= endBlock ? endBlock : endNum,
        tokenType: type,
        contractAddress: address,
      });
    }
    return tasks;
  }

  async sendMessage<T = any>(payload: Message<T> | Message<T>[]) {
    const originalMessages = Array.isArray(payload) ? payload : [payload];
    const messages = originalMessages.map((message) => {
      let body = message.body;
      if (typeof body !== 'string') {
        body = JSON.stringify(body) as any;
      }

      return {
        ...message,
        body,
      };
    });

    return await this.sqsProducer.send(messages as Message[]);
  }
}
