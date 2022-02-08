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
  CreateNFTCollectionTaskDto,
  QueueMessageBody,
  TaskPerBlock,
} from '../nft-collection-task/dto/create-nft-collection-task.dto';

@Injectable()
export class SqsProducerService implements OnModuleInit, SqsProducerHandler {
  public sqsProducer: Producer;
  private readonly logger = new Logger(SqsProducerService.name);

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
  }

  public onModuleInit() {
    this.sqsProducer = Producer.create({
      queueUrl: this.configService.get('aws.queueUrl'),
      sqs: new AWS.SQS(),
    });
  }

  /**
   * #1. check if there is any collection not processed
   * #2. split to tasks and send to queue
   * #3. save tasks to DB
   * #4. mark collection as processed
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  public async checkCollection() {
    // Check if there is any unprocessed collection
    const unprocessed = await this.nftCollectionService.findUnprocessedOne();
    if (!unprocessed) {
      return;
    }
    this.logger.log(
      `[CRON Collection] Recevied new NFT collection: ${unprocessed.contractAddress}`,
    );
    this.nftCollectionService.markAsChecked(unprocessed.contractAddress);

    // Prepare tasks
    const currentBlock = 12981360; //await this.ethereumService.getBlockNum();
    const tasks = this.eventlySpace(
      unprocessed.contractAddress,
      unprocessed.tokenType,
      unprocessed.createdAtBlock,
      currentBlock,
      200,
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
      `[CRON Collection] Successfully sent ${queueResults.length} messages for collection ${unprocessed.contractAddress}`,
    );

    // Prepare collection tasks to save to DB as batch
    // const collectionTasks: CreateNFTCollectionTaskDto[] = tasks.map(
    //   (task, index) => ({
    //     messageId: queueResults[index].MessageId,
    //     contractAddress: task.contractAddress,
    //     tokenType: task.tokenType,
    //     startBlock: task.startBlock,
    //     endBlock: task.endBlock,
    //     status: 'sent',
    //   }),
    // );
    // const taskResults = await this.nftCollectionTaskService.batchInsert(
    //   collectionTasks,
    // );
    // this.logger.log(
    //   `[CRON Collection] Successfully saved ${taskResults.length} tasks for collection ${unprocessed.contractAddress}`,
    // );

    // Mark this collection
    await this.nftCollectionService.markAsProcessed(
      unprocessed.contractAddress,
    );
    this.logger.log(
      `[CRON Collection] Successfully processed collection ${unprocessed.contractAddress}`,
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
    const tasks = this.eventlySpace(
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

    // Prepare collection tasks to save to DB as batch
    // const collectionTasks: CreateNFTCollectionTaskDto[] = tasks.map(
    //   (task, index) => ({
    //     messageId: queueResults[index].MessageId,
    //     contractAddress: task.contractAddress,
    //     tokenType: task.tokenType,
    //     startBlock: task.startBlock,
    //     endBlock: task.endBlock,
    //     status: 'sent',
    //   }),
    // );
    // const taskResults = await this.nftCollectionTaskService.batchInsert(
    //   collectionTasks,
    // );
    // this.logger.log(
    //   `[CRON Task] Successfully saved ${taskResults.length} tasks for collection ${unprocessed.contractAddress}`,
    // );

    // Mark this collection
    await this.nftCollectionTaskService.deleteOne(unprocessed.id);
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

  private eventlySpace(
    address: string,
    type: 'ERC721' | 'ERC1155',
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
