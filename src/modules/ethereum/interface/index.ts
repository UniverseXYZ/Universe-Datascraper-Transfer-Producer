export enum EthereumNetworkType {
  mainnet = 'mainnet',
  rinkeby = 'rinkeby',
  aws = 'aws',
  ropsten = 'ropsten',
}

export type NetworkType = keyof typeof EthereumNetworkType;

export type InfuraProject = {
  projectId: string;
  projectSecret: string;
};

export type ProviderOptions = {
  quorum: number;
  alchemy: string;
  infura: InfuraProject
};