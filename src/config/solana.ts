import { Connection } from '@solana/web3.js';

// Khai báo các biến môi trường
export const NETWORK = process.env.REACT_APP_SOLANA_NETWORK || 'devnet';
export const RPC_ENDPOINT = process.env.REACT_APP_RPC_ENDPOINT || 'https://rpc.lazorkit.xyz/';

// Khởi tạo Connection với cấu hình WebSocket
export const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: 'https://rpc.lazorkit.xyz/ws/',
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 60000
}); 