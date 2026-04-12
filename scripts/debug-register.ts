import { createPublicClient, createWalletClient, http, decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { xLayerTestnet } from 'viem/chains';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pk = process.env.PRIVATE_KEY!;
  const reg = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
  const rpc = process.env.XLAYER_TESTNET_RPC || 'https://testrpc.xlayer.tech/terigon';
  const account = privateKeyToAccount(pk as `0x${string}`);
  const pc = createPublicClient({ chain: xLayerTestnet, transport: http(rpc) });
  const wc = createWalletClient({ account, chain: xLayerTestnet, transport: http(rpc) });
  const abi = [
    {inputs:[{internalType:'string',name:'agentURI',type:'string'}],name:'register',outputs:[{internalType:'uint256',name:'agentId',type:'uint256'}],stateMutability:'nonpayable',type:'function'},
    {anonymous:false,inputs:[{indexed:true,internalType:'uint256',name:'agentId',type:'uint256'},{indexed:false,internalType:'string',name:'agentURI',type:'string'},{indexed:true,internalType:'address',name:'owner',type:'address'}],name:'Registered',type:'event'}
  ] as const;
  const hash = await wc.writeContract({
    address: reg as `0x${string}`,
    abi,
    functionName: 'register',
    args: ['https://example.com/agent.json']
  });
  console.log('tx', hash);
  const receipt = await pc.waitForTransactionReceipt({ hash });
  console.log('status', receipt.status, 'logs', receipt.logs.length);
  for (const log of receipt.logs) {
    console.log('log address', log.address, 'topics', log.topics);
    try {
      const ev = decodeEventLog({ abi, eventName: 'Registered', data: log.data, topics: log.topics });
      console.log('parsed agentId', ev.args.agentId);
    } catch {}
  }
}
main().catch(console.error);
