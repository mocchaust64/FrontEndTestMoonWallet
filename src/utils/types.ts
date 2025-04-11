import { PublicKey } from '@solana/web3.js';
import { BN } from '@project-serum/anchor';

// Định nghĩa type cho thông tin ví
export interface WalletInfo {
  address: string;
  credential_id: string;
  threshold: number; 
  recovery_seed: string;
  password_hash?: string;
}

// Định nghĩa type cho các tham số WebAuthn
export interface WebAuthnCredential {
  id: string;
  publicKey: string;
  type: string;
}

// Định nghĩa ActionParams cho các đề xuất multisig
export interface ActionParams {
  amount: BN | null;
  destination: PublicKey | null;
  tokenMint: PublicKey | null;
}

// Hàm tạo ActionParams
export const createActionParams = (
  amount?: BN | number,
  destination?: PublicKey | string,
  tokenMint?: PublicKey | string
): ActionParams => {
  return {
    amount: amount ? (typeof amount === 'number' ? new BN(amount) : amount) : null,
    destination: destination 
      ? (typeof destination === 'string' ? new PublicKey(destination) : destination) 
      : null,
    tokenMint: tokenMint 
      ? (typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint) 
      : null,
  };
};

// Các type khác nếu cần 