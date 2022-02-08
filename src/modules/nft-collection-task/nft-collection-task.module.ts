import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NFTCollectionTaskService } from './nft-collection-task.service';
import {
  NFTCollectionTask,
  NFTCollectionTaskSchema,
} from './schemas/nft-collection-task.shema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NFTCollectionTask.name, schema: NFTCollectionTaskSchema },
    ]),
  ],
  providers: [NFTCollectionTaskService],
  exports: [NFTCollectionTaskService],
})
export class NFTCollectionTaskModule {}
