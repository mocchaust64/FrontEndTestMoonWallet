import React, { createContext, useContext, useState, useEffect } from 'react';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import { getMultisigPDA, getGuardianPDA } from '../utils/credentialUtils';

// Định nghĩa kiểu dữ liệu cho context
interface ProgramContextType {
  program: anchor.Program<any> | null;
  multisigPDA: PublicKey | null;
  guardianPDA: PublicKey | null;
  loading: boolean;
  error: string | null;
  refreshMultisig: () => void;
}

// Tạo context
const ProgramContext = createContext<ProgramContextType>({
  program: null,
  multisigPDA: null,
  guardianPDA: null,
  loading: false,
  error: null,
  refreshMultisig: () => {}
});

// Custom hook để sử dụng context
export const useProgram = () => useContext(ProgramContext);

// Custom hook để lấy thông tin ví multisig
export const useMultisigState = () => {
  const { multisigPDA, guardianPDA, loading, error } = useContext(ProgramContext);
  return { multisigPDA, guardianPDA, loading, error };
};

// Provider component
export const ProgramProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  
  const [program, setProgram] = useState<anchor.Program<any> | null>(null);
  const [multisigPDA, setMultisigPDA] = useState<PublicKey | null>(null);
  const [guardianPDA, setGuardianPDA] = useState<PublicKey | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  // Khởi tạo chương trình Anchor khi có wallet
  useEffect(() => {
    const initProgram = async () => {
      if (!wallet) {
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        setError(null);
        
        // ID chương trình Moon Wallet
        const programId = new PublicKey('5tFJskbgqrPxb992SUf6JzcQWJGbJuvsta2pRnZBcygN');
        
        // Tạo provider trước
        const provider = new anchor.AnchorProvider(
          connection,
          wallet,
          { preflightCommitment: 'confirmed' }
        );
        
        // Lấy IDL bằng provider - sử dụng @ts-ignore để tránh lỗi kiểu
        // @ts-ignore - bỏ qua lỗi TypeScript vì API có khác biệt giữa các phiên bản Anchor
        const idl = await anchor.Program.fetchIdl(programId, provider);
        
        if (!idl) {
          throw new Error('Không thể tải IDL của chương trình');
        }
        
        // Sử dụng provider đã tạo để khởi tạo program
        // @ts-ignore - Bỏ qua lỗi TypeScript do sự khác biệt giữa các phiên bản Anchor
        const program = new anchor.Program(
          idl as any, 
          programId as any, 
          provider as any
        );
        setProgram(program);
        
        // Lấy credential ID từ localStorage (nếu có)
        const credentialId = localStorage.getItem('walletCredentialId');
        
        if (credentialId) {
          // Tính MultisigPDA và GuardianPDA
          const multisigAddress = await getMultisigPDA(credentialId);
          setMultisigPDA(multisigAddress);
          
          const guardianAddress = await getGuardianPDA(multisigAddress, 1); // Guardian ID 1 (Owner)
          setGuardianPDA(guardianAddress);
        }
        
        setLoading(false);
      } catch (err: any) {
        console.error('Lỗi khi khởi tạo chương trình:', err);
        setError(err.message || 'Lỗi không xác định khi khởi tạo chương trình');
        setLoading(false);
      }
    };
    
    initProgram();
  }, [connection, wallet]);
  
  // Hàm làm mới dữ liệu multisig
  const refreshMultisig = async () => {
    if (!wallet) return;
    
    try {
      setLoading(true);
      setError(null);
      
      // Lấy credential ID từ localStorage
      const credentialId = localStorage.getItem('walletCredentialId');
      
      if (credentialId) {
        // Tính lại MultisigPDA và GuardianPDA
        const multisigAddress = await getMultisigPDA(credentialId);
        setMultisigPDA(multisigAddress);
        
        const guardianAddress = await getGuardianPDA(multisigAddress, 1);
        setGuardianPDA(guardianAddress);
      }
      
      setLoading(false);
    } catch (err: any) {
      console.error('Lỗi khi làm mới dữ liệu multisig:', err);
      setError(err.message || 'Lỗi không xác định khi làm mới dữ liệu');
      setLoading(false);
    }
  };
  
  // Giá trị context
  const value = {
    program,
    multisigPDA,
    guardianPDA,
    loading,
    error,
    refreshMultisig
  };
  
  return (
    <ProgramContext.Provider value={value}>
      {children}
    </ProgramContext.Provider>
  );
}; 