import * as dotenv from "dotenv";

dotenv.config();

const network = (process.env.NETWORK || "testnet") as "mainnet" | "testnet";

const networkConfig = {
  mainnet: {
    rpc: process.env.XLAYER_RPC || "https://rpc.xlayer.tech",
    chainId: 196,
    identityRegistry: process.env.IDENTITY_REGISTRY || "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: process.env.REPUTATION_REGISTRY || "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  },
  testnet: {
    rpc: process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon",
    chainId: 1952,
    identityRegistry: process.env.IDENTITY_REGISTRY || "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: process.env.REPUTATION_REGISTRY || "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  },
} as const;

const net = networkConfig[network];

export const config = {
  network,
  privateKey: process.env.PRIVATE_KEY || "",
  rpc: net.rpc,
  chainId: net.chainId,
  identityRegistry: net.identityRegistry,
  reputationRegistry: net.reputationRegistry,
  validationRegistry: process.env.VALIDATION_REGISTRY || "",
  validatorAddress: process.env.VALIDATOR_ADDRESS || "",
  aavePool: process.env.AAVE_POOL || "0xE3F3Caefdd7180F884c01E57f65Df979Af84f116",
};
