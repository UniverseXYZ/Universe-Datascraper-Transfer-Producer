import { Injectable } from '@nestjs/common';
import { EthereumNetworkType } from './interface';
import { ethers } from 'ethers';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EthereumService {
  public ether: any;

  constructor(private configService: ConfigService) {
    const key = this.configService.get('ethereum_network');

    const projectSecret = this.configService.get('infura.project_secret');
    const projectId = this.configService.get('infura.project_id');

    const alchemy_token = this.configService.get('alchemy_token')

    if (!projectSecret || !projectId || !alchemy_token) {
      throw new Error('Infura project id or secret or alchemy token is not defined');
    }
    const ethersProvider = ethers.getDefaultProvider(EthereumNetworkType[key], {
      infura: {
        projectId,
        projectSecret,
      },
      alchemy: alchemy_token,
      quorum: 1
    });
    this.ether = ethersProvider;
  }

  public async getBlockNum() {
    return this.ether.getBlockNumber();
  }
}
