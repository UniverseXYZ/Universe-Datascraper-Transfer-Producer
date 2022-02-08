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

  public async findUnprocessedOne() {
    return await this.nftCollectionModel.findOne({
      sentAt: null,
      firstCheckAt: null,
    });
  }

  public async markAsChecked(contractAddress: string) {
    await this.nftCollectionModel.updateOne(
      {
        contractAddress,
      },
      {
        firstCheckAt: new Date(),
      },
    );
  }

  public async markAsProcessed(contractAddress: string) {
    await this.nftCollectionModel.updateOne(
      {
        contractAddress,
      },
      {
        sentAt: new Date(),
      },
    );
  }

  public async insertOne() {
    // this.NFTCollectionModel.insertMany({
    //   contractAddress: '0xccc441ac31f02cd96c153db6fd5fe0a2f4e6a68d',
    //   tokenType: 'ERC721',
    //   createdAtBlock: 12966912,
    // });
  }
}
