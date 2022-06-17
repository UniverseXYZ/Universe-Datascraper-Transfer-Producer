export default () => ({
  mongodb: {
    uri: process.env.MONGODB_URI,
  },
  port: process.env.PORT,
  app_env: process.env.APP_ENV,
  alchemy_token: process.env.ALCHEMY_TOKEN,
  chainstack_url: process.env.CHAINSTACK_URL,
  quicknode_url: process.env.QUICKNODE_URL,
  ethereum_network: process.env.ETHEREUM_NETWORK,
  ethereum_quorum: process.env.ETHEREUM_QUORUM,
  session_secret: process.env.SESSION_SECRET,
  infura: {
    project_id: process.env.INFURA_PROJECT_ID,
    project_secret: process.env.INFURA_PROJECT_SECRET,
  },
  aws: {
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    queueUrl: process.env.AWS_QUEUE_URL,
  },
  etherscan_api_key: process.env.ETHERSCAN_API_KEY,
  queue_config: {
    block_interval: process.env.BLOCKS_INTERVAL,
    message_num: process.env.MESSAGES_PER_PROCESS,
    end_block: process.env.END_BLOCK,
  },
  query_limit: process.env.QUERY_LIMIT,
});
