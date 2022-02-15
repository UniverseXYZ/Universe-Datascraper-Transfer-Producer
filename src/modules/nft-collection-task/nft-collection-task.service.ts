import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateNFTCollectionTaskDto } from './dto/create-nft-collection-task.dto';
import {
  NFTCollectionTask,
  NFTCollectionTaskDocument,
} from './schemas/nft-collection-task.shema';

@Injectable()
export class NFTCollectionTaskService {
  private readonly logger = new Logger(NFTCollectionTaskService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(NFTCollectionTask.name)
    private readonly nftCollectionTaskModel: Model<NFTCollectionTaskDocument>,
  ) {}

  async updateNFTCollectionTask(
    status: CreateNFTCollectionTaskDto,
  ): Promise<NFTCollectionTask> {
    return await this.nftCollectionTaskModel.findOneAndUpdate(
      {
        messageId: status.messageId,
      },
      status,
      {
        upsert: true,
      },
    );
  }

  async batchInsert(records: CreateNFTCollectionTaskDto[]) {
    return await this.nftCollectionTaskModel.insertMany(records);
  }

  public async findSplitOne() {
    return await this.nftCollectionTaskModel.findOne({
      status: 'split',
    });
  }

  public async deleteOne(messageId: string) {
    await this.nftCollectionTaskModel.deleteOne({ messageId });
  }
}
