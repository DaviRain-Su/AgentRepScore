import * as dotenv from "dotenv";

dotenv.config();

export const config = {
  privateKey: process.env.PRIVATE_KEY || "",
  xlayerRpc: process.env.XLAYER_RPC || "https://xlayerrpc.okx.com",
  xlayerTestnetRpc: process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech",
  identityRegistry: process.env.IDENTITY_REGISTRY || "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  reputationRegistry: process.env.REPUTATION_REGISTRY || "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  validationRegistry: process.env.VALIDATION_REGISTRY,
  validatorAddress: process.env.VALIDATOR_ADDRESS || "",
  aavePool: process.env.AAVE_POOL || "0xE3F3Caefdd7180F884c01E57f65Df979Af84f116",
};
