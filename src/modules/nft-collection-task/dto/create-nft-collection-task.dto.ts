export class CreateNFTCollectionTaskDto {
  messageId: string;
  contractAddress: string;
  startBlock: number;
  endBlock: number;
  status: string;
}

export class TaskPerBlock {
  startBlock: number;
  endBlock: number;
}

export interface QueueMessageBody {
  contractAddress: string;
  tokenType: string;
  startBlock: number;
  endBlock: number;
}
