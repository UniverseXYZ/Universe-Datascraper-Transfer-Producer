import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Consumer } from 'sqs-consumer';
import AWS from 'aws-sdk';
import {
  ERROR_EVENT_NAME,
  PROCESSING_ERROR_EVENT_NAME,
  SqsConsumerHandler,
  TIMEOUT_EVENT_NAME,
} from './sqs-consumer.types';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SqsConsumerService
  implements SqsConsumerHandler, OnModuleInit, OnModuleDestroy
{
  public sqsConsumer: Consumer;

  constructor(private configService: ConfigService) {
    AWS.config.update({
      region: this.configService.get('aws.region'),
      accessKeyId: this.configService.get('aws.accessKeyId'),
      secretAccessKey: this.configService.get('aws.secretAccessKey'),
    });
  }

  public onModuleInit() {
    this.sqsConsumer = Consumer.create({
      queueUrl: this.configService.get('aws.queueUrl'),
      sqs: new AWS.SQS(),
      handleMessage: this.handleMessage.bind(this),
    });

    this.sqsConsumer.addListener(ERROR_EVENT_NAME, this.onError.bind(this));
    this.sqsConsumer.addListener(
      PROCESSING_ERROR_EVENT_NAME,
      this.onProcessingError.bind(this),
    );
    this.sqsConsumer.addListener(
      TIMEOUT_EVENT_NAME,
      this.onTimeoutError.bind(this),
    );

    this.sqsConsumer.start();
  }

  public onModuleDestroy() {
    this.sqsConsumer.stop();
  }

  async handleMessage(message: AWS.SQS.Message): Promise<void> {
    throw new Error('Method not implemented.');
  }

  onError(error: Error, message: AWS.SQS.Message): Promise<void> {
    throw new Error('Method not implemented.');
  }

  onProcessingError(error: Error, message: AWS.SQS.Message): Promise<void> {
    throw new Error('Method not implemented.');
  }

  onTimeoutError(error: Error, message: AWS.SQS.Message): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
