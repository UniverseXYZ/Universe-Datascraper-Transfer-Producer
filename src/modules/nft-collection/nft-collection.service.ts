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

  // public async findUnprocessedOne() {
  //   return await this.nftCollectionModel.findOne({
  //     sentAt: null,
  //     isProcessing: false,
  //   });
  // }

  public async findUnfinishedOne(currentBlock: number) {
    return await this.nftCollectionModel.findOne({
      isProcessing: { $in: [null, false] },
      $or: [
        { lastProcessedBlock: { $lt: currentBlock } },
        { lastProcessedBlock: { $exists: false } },
      ],
    });
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
