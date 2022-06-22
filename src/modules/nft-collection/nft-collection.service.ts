import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { unfold } from 'ramda';
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

  public async findUnfinishedForwardFlow(
    currentBlock: number,
    isVip: boolean,
    limit: number,
  ) {
    return await this.nftCollectionModel.find(
      {
        vip: isVip ? true : { $in: [null, false] }, // null
        isProcessing: { $in: [null, false] }, // false
        createdAtBlock: { $exists: true }, //10052240
        $or: [
          { lastProcessedBlock: { $lt: currentBlock } }, // 10313929
          { lastProcessedBlock: { $exists: false } },
          { targetBlock: { $exists: true } },
        ],
      },
      {},
      {
        limit,
        sort: { lastProcessedBlock: 1 },
      },
    );
  }

  public async findUnfinishedBackwardFlow(
    endBlock: number,
    isVip: boolean,
    limit: number,
  ) {
    return await this.nftCollectionModel.find(
      {
        vip: isVip ? true : { $in: [null, false] },
        isProcessingBackward: { $in: [null, false] },
        createdAtBlock: { $exists: true },
        $or: [
          { firstProcessedBlock: { $lt: endBlock } },
          { firstProcessedBlock: { $exists: false } },
          { targetBlock: { $exists: true } },
        ],
      },
      {},
      {
        limit,
        sort: { firstProcessedBlock: -1 },
      },
    );
  }

  public async findExpiredOnesForward(): Promise<string[]> {
    const results = await this.nftCollectionModel.find(
      {
        sentAt: { $lt: new Date(Date.now() - 60 * 1000) },
        isProcessing: true,
      },
      {
        contractAddress: 1,
      },
    );

    return results.map((result) => result.contractAddress);
  }

  public async findExpiredOnesBackward(): Promise<string[]> {
    const results = await this.nftCollectionModel.find(
      {
        sentAt: { $lt: new Date(Date.now() - 60 * 1000) },
        isProcessingBackward: true,
      },
      {
        contractAddress: 1,
      },
    );

    return results.map((result) => result.contractAddress);
  }

  public async resetExpiredOnesForward(contractAddresses: string[]) {
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

  public async resetExpiredOnesBackward(contractAddresses: string[]) {
    return await this.nftCollectionModel.bulkWrite(
      contractAddresses.map((contractAddress) => ({
        updateOne: {
          filter: {
            contractAddress,
          },
          update: {
            $set: {
              isProcessingBackward: false,
            },
          },
        },
      })),
    );
  }

  public async markAsProcessingForward(unprocessed: any[]) {
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

  public async markAsProcessingBackward(unprocessed: any[]) {
    await this.nftCollectionModel.bulkWrite(
      unprocessed.map((x) => ({
        updateOne: {
          filter: {
            contractAddress: x.contractAddress,
          },
          update: { isProcessingBackward: true },
        },
      })),
    );
  }

  public async markAsProcessedForwardFlow(processed: any[]) {
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

  public async markAsProcessedBackwardFlow(processed: any[]) {
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
                  isProcessingBackward: false,
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
              isProcessingBackward: false,
            },
            upsert: false,
          },
        };
      }),
    );
  }
}
