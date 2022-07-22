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

  public async findSplitOne(source: string, vip: boolean) {
    return await this.nftCollectionTaskModel.findOne({
      status: 'split',
      source: source,
      vip: vip ? true: { $in: [null, false] }
    });
  }

  public async deleteOne(messageId: string) {
    await this.nftCollectionTaskModel.deleteOne({ messageId });
  }
}
