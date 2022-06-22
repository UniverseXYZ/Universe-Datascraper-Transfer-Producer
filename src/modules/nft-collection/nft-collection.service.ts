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

  public async findUnfinished(
    currentBlock: number,
    isVip: boolean,
    limit: number,
    source: string,
  ) {
    return await this.nftCollectionModel
      .find(
        {
          source,
          vip: isVip ? true : { $in: [null, false] },
          isProcessing: { $in: [null, false] },
          createdAtBlock: { $exists: true },
          $or: [
            { lastProcessedBlock: { $lt: currentBlock } },
            { lastProcessedBlock: { $exists: false } },
            { targetBlock: { $exists: true } },
          ],
        },
        {},
        {
          limit,
          sort: { lastProcessedBlock: 1 },
        },
      )
      .lean();
  }

  public async findExpiredOnes(source: string): Promise<string[]> {
    const results = await this.nftCollectionModel.find(
      {
        source,
        sentAt: { $lt: new Date(Date.now() - 60 * 1000) },
        isProcessing: true,
      },
      {
        contractAddress: 1,
      },
    );

    return results.map((result) => result.contractAddress);
  }

  public async resetExpiredOnes(contractAddresses: string[]) {
    return await this.nftCollectionModel.bulkWrite(
      contractAddresses.map((contractAddress) => ({
        updateOne: {
          filter: {
            contractAddress,
          },
          update: {
            $set: {
              isProcessing: false,
            },
          },
        },
      })),
    );
  }

  public async markAsProcessing(unprocessed: any[]) {
    await this.nftCollectionModel.bulkWrite(
      unprocessed.map((x) => ({
        updateOne: {
          filter: {
            contractAddress: x.contractAddress,
          },
          update: { isProcessing: true },
        },
      })),
    );
  }

  public async markAsProcessed(processed: any[]) {
    await this.nftCollectionModel.bulkWrite(
      processed.map((collection) => {
        const {
          contractAddress,
          firstProcessedBlock,
          lastProcessedBlock,
          isFinished,
        } = collection;

        if (isFinished) {
          return {
            updateOne: {
              filter: {
                contractAddress,
              },
              update: {
                $set: {
                  sentAt: new Date(),
                  firstProcessedBlock,
                  lastProcessedBlock,
                  isProcessing: false,
                },
                $unset: {
                  targetBlock: '',
                },
              },
              upsert: false,
            },
          };
        }

        return {
          updateOne: {
            filter: {
              contractAddress,
            },
            update: {
              sentAt: new Date(),
              firstProcessedBlock,
              lastProcessedBlock,
              isProcessing: false,
            },
            upsert: false,
          },
        };
      }),
    );
  }
}
