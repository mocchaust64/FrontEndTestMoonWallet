import { PublicKey } from '@solana/web3.js';

// Lấy PROGRAM_ID từ biến môi trường hoặc dùng giá trị mặc định
const PROGRAM_ID_STRING = process.env.REACT_APP_PROGRAM_ID || '5tFJskbgqrPxb992SUf6JzcQWJGbJuvsta2pRnZBcygN';

// Export PROGRAM_ID để có thể sử dụng trong toàn bộ ứng dụng
export const PROGRAM_ID = new PublicKey(PROGRAM_ID_STRING); 