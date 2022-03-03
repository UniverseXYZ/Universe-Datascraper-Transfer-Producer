import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Producer } from 'sqs-producer';
import AWS from 'aws-sdk';
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

@Injectable()
export class SqsProducerService implements OnModuleInit, SqsProducerHandler {
  public sqsProducer: Producer;
  private readonly logger = new Logger(SqsProducerService.name);
  private readonly blockInterval: number;
  private readonly messageNum: number;
  private readonly stopSendBlock: number;

  constructor(
    private configService: ConfigService,
    private readonly nftCollectionTaskService: NFTCollectionTaskService,
    private readonly nftCollectionService: NFTCollectionService,
    private readonly ethereumService: EthereumService,
  ) {
    AWS.config.update({
      region: this.configService.get('aws.region'),
      accessKeyId: this.configService.get('aws.accessKeyId'),
      secretAccessKey: this.configService.get('aws.secretAccessKey'),
    });
    this.blockInterval = this.configService.get('queue_config.block_interval');
    this.messageNum = this.configService.get('queue_config.message_num');
    this.stopSendBlock = this.configService.get('queue_config.end_block');
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
  public async checkCollection() {
    // Check if there is any unprocessed collection
    const currentBlock =
      this.stopSendBlock ?? (await this.ethereumService.getBlockNum());

    const unprocessed = await this.nftCollectionService.findUnfinishedOne(
      currentBlock,
    );
    if (!unprocessed) {
      return;
    }
    this.logger.log(
      `[CRON Collection ${unprocessed.contractAddress}] Find Unfinished collection. Already processed to ${unprocessed.lastProcessedBlock}. Current configured end block: ${currentBlock}`,
    );
    this.nftCollectionService.markAsProcessing(unprocessed.contractAddress);

    // Prepare tasks
    const startBlock = R.is(Number, unprocessed.lastProcessedBlock)
      ? unprocessed.lastProcessedBlock + 1
      : unprocessed.createdAtBlock;
    let endBlock = startBlock + this.blockInterval * this.messageNum;
    endBlock = endBlock >= currentBlock ? currentBlock : endBlock;
    const tasks = this.eventlySpaceByStep(
      unprocessed.contractAddress,
      unprocessed.tokenType,
      startBlock,
      endBlock,
      this.blockInterval,
    );
    this.logger.log(
      `[CRON Collection ${unprocessed.contractAddress}] Generated ${tasks.length} tasks between block [${startBlock} - ${endBlock}] with block interval ${this.blockInterval}`,
    );

    // Prepare queue messages and sent as batch
    if (tasks.length > 0) {
      const messages: Message<QueueMessageBody>[] = tasks.map((task) => {
        const id = `${unprocessed.contractAddress}-${task.startBlock}-${task.endBlock}`;
        return {
          id,
          body: task,
          groupId: unprocessed.contractAddress,
          deduplicationId: id,
        };
      });
      const queueResults = await this.sendMessage(messages);
      this.logger.log(
        `[CRON Collection ${unprocessed.contractAddress}] Successfully sent ${queueResults.length} messages for collection`,
      );
    }

    // Mark this collection
    await this.nftCollectionService.markAsProcessed(
      unprocessed.contractAddress,
      unprocessed.createdAtBlock,
      endBlock,
    );
    this.logger.log(
      `[CRON Collection ${unprocessed.contractAddress}] Successfully processed collection to block ${endBlock}`,
    );
  }

  /**
   * #1. check if there is any task need to be splited
   * #2. split to 2 tasks and send to queue
   * #3. save 2 new tasks to DB
   * #4. delete task as processed
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  public async checkCollectionTask() {
    // Check if there is any unprocessed collection
    const unprocessed = await this.nftCollectionTaskService.findSplitOne();
    if (!unprocessed) {
      return;
    }
    this.logger.log(
      `[CRON Task] Find one task need to be splited: ${unprocessed.contractAddress} from block ${unprocessed.startBlock} to ${unprocessed.endBlock}`,
    );

    // Prepare tasks
    const tasks = this.eventlySpaceByCardinality(
      unprocessed.contractAddress,
      unprocessed.tokenType,
      unprocessed.startBlock,
      unprocessed.endBlock,
      2,
    );

    // Prepare queue messages and sent as batch
    const messages: Message<QueueMessageBody>[] = tasks.map((task) => {
      const id = `${unprocessed.contractAddress}-${task.startBlock}-${task.endBlock}`;
      return {
        id,
        body: task,
        groupId: unprocessed.contractAddress,
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

    return await this.sqsProducer.send(messages as any[]);
  }
}
