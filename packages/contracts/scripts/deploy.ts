import { network } from 'hardhat';

const connection = await network.getOrCreate();
const veriTrade = await connection.viem.deployContract('VeriTrade');

console.log(`VeriTrade deployed to ${veriTrade.address}`);
