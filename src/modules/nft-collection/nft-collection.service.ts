import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  NFTCollection,
  NFTCollectionDocument,
} from './schemas/nft-collection.shema';

@Injectable()
export class NFTCollectionService {
  private readonly logger = new Logger(NFTCollectionService.name);

  constructor(
    @InjectModel(NFTCollection.name)
    private readonly nftCollectionModel: Model<NFTCollectionDocument>,
  ) {}

  public async findUnfinishedOne(currentBlock: number, isVip: boolean) {
    return await this.nftCollectionModel.findOne(
      {
        vip: isVip ? true : { $in: [null, false] },
        isProcessing: { $in: [null, false] },
        createdAtBlock: { $exists: true },
        $or: [
          { lastProcessedBlock: { $lt: currentBlock } },
          { lastProcessedBlock: { $exists: false } },
        ],
      },
      {},
      {
        sort: { lastProcessedBlock: 1 },
      },
    );
  }

  public async markAsProcessing(contractAddress: string) {
    await this.nftCollectionModel.updateOne(
      {
        contractAddress,
      },
      {
        isProcessing: true,
      },
    );
  }

  public async markAsProcessed(
    contractAddress: string,
    firstProcessedBlock: number,
    lastProcessedBlock: number,
  ) {
    await this.nftCollectionModel.updateOne(
      {
        contractAddress,
      },
      {
        sentAt: new Date(),
        firstProcessedBlock,
        lastProcessedBlock,
        isProcessing: false,
      },
    );
  }
}
