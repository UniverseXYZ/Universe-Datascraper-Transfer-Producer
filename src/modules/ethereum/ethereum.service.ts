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
    
    const alchemyToken = this.configService.get('alchemy_token')
    
    if (!(projectSecret && projectId) && !alchemyToken) {
      throw new Error('Infura project id and secret or alchemy token is not defined');
    }
    
    const opts = {}
    opts['quorum'] = 1;

    if(projectSecret && projectId){
      opts['infura'] = {
        projectId,
        projectSecret
      }
    }

    if (alchemyToken){
      opts['alchemy'] = alchemyToken
    }
    
    const ethersProvider = ethers.getDefaultProvider(EthereumNetworkType[key], opts);
    this.ether = ethersProvider;
  }

  public async getBlockNum() {
    return this.ether.getBlockNumber();
  }
}
