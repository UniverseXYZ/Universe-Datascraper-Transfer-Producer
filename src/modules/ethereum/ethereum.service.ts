import { Injectable } from '@nestjs/common';
import { EthereumNetworkType, InfuraProject, ProviderOptions } from './interface';
import { ethers } from 'ethers';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EthereumService {
  public ether: ethers.providers.BaseProvider;

  constructor(private configService: ConfigService) {
    const network: ethers.providers.Networkish = this.configService.get('ethereum_network');
    const quorum: number = Number(this.configService.get('ethereum_quorum'));

    const projectSecret: string = this.configService.get('infura.project_secret');
    const projectId: string = this.configService.get('infura.project_id');
    const infura:InfuraProject = projectId && projectSecret
      ? { projectId, projectSecret }
      : undefined;
      
    const alchemyToken: string = this.configService.get('alchemy_token')
    const alchemy: string = alchemyToken ? alchemyToken : undefined

    if (!infura && !alchemy) {
      throw new Error('Infura project id and secret or alchemy token is not defined');
    }
        
    const opts: ProviderOptions = {
      quorum: quorum,
      alchemy: alchemy,
      infura: infura
    }
    
    const ethersProvider: ethers.providers.BaseProvider = ethers.getDefaultProvider(network, opts);
    this.ether = ethersProvider;
  }

  public async getBlockNum() {
    return this.ether.getBlockNumber();
  }
}
