import { Module } from '@nestjs/common';
import { SqsConsumerService } from './sqs-consumer.service';

@Module({
  providers: [SqsConsumerService],
  exports: [SqsConsumerService],
})
export class SqsConsumerModule {}
