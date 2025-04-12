import React, { useState, useEffect } from 'react';
import { PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import { Program, BN } from '@coral-xyz/anchor';
import {
  findMultisigWallet,
  loadProposals,
  initializeProgram,
  getEnvKeypair
} from '../utils/multisig/multisigUtils';
import { Connection } from '@solana/web3.js';
import { getWebAuthnAssertion, createWebAuthnVerificationData } from '../utils/webauthnUtils';
import { 
  createSecp256r1Instruction,
  checkSecp256r1Program,
  derToRaw,
  SYSVAR_CLOCK_PUBKEY
} from '../utils/transactionUtils';
import { createActionParams } from '../utils/types';
import { getWalletByCredentialId, getCredentialsByWallet } from '../firebase/webAuthnService';
import { getGuardianPDA } from '../utils/credentialUtils';
import { TransactionInstruction } from '@solana/web3.js';
import { PROGRAM_ID } from '../utils/constants';
import { Timestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { createProposal, addSignerToProposal, updateProposalStatus, getProposalsByWallet } from '../firebase/proposalService';
import { sha256 } from '@noble/hashes/sha256';

const SECP256R1_ORDER = new BN('FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551', 16);
const SECP256R1_HALF_ORDER = SECP256R1_ORDER.shrn(1);

/**
 * Chuẩn hóa chữ ký về dạng Low-S
 * @param signature - Chữ ký raw
 * @returns Chữ ký đã chuẩn hóa
 */
const normalizeSignatureToLowS = (sig: Buffer): Buffer => {
  const r = sig.slice(0, 32);
  const s = sig.slice(32, 64);
  
  const sBN = new BN(s);
  console.log("S value (BN):", sBN.toString(16));
  console.log("HALF_ORDER:", SECP256R1_HALF_ORDER.toString(16));
  
  // Kiểm tra nếu s > half_order
  if (sBN.gt(SECP256R1_HALF_ORDER)) {
    console.log("Chuẩn hóa signature về dạng Low-S");
    // Tính s' = order - s
    const sNormalized = SECP256R1_ORDER.sub(sBN);
    console.log("S normalized:", sNormalized.toString(16));
    const sNormalizedBuffer = sNormalized.toArrayLike(Buffer, 'be', 32);
    return Buffer.concat([r, sNormalizedBuffer]);
  }
  
  console.log("Signature đã ở dạng Low-S");
  return sig;
};

// Program ID mặc định để hiển thị
const PROGRAM_ID_STRING = process.env.REACT_APP_PROGRAM_ID || '5tFJskbgqrPxb992SUf6JzcQWJGbJuvsta2pRnZBcygN';

// Tạo một mock class để giải quyết lỗi
class MoonWalletMultisig {
  static async create(
    connection: Connection,
    credentialId: Uint8Array,
    members: PublicKey[],
    threshold: number
  ) {
    console.log('Tạo ví đa chữ ký với:', { credentialId, members, threshold });
    // Trả về một địa chỉ giả để sử dụng trong mock
    return {
      address: new PublicKey('DeN1rBfabZezHPvrq9q7BbzUbZkrjnHE1kQDrPK8kWQ3')
    };
  }

  static async createProposal(
    connection: Connection,
    credentialId: Uint8Array,
    multisigAddress: PublicKey,
    transaction: Transaction
  ) {
    console.log('Tạo đề xuất cho multisig:', { multisigAddress: multisigAddress.toBase58() });
    // Trả về một id đề xuất giả
    return {
      id: new PublicKey('5tFJskbgqrPxb992SUf6JzcQWJGbJuvsta2pRnZBcygN')
    };
  }

  static async approveProposal(
    connection: Connection,
    credentialId: Uint8Array,
    multisigAddress: PublicKey,
    proposalId: PublicKey
  ) {
    console.log('Phê duyệt đề xuất:', { 
      multisigAddress: multisigAddress.toBase58(),
      proposalId: proposalId.toBase58()
    });
    return true;
  }

  static async executeProposal(
    connection: Connection,
    credentialId: Uint8Array,
    multisigAddress: PublicKey,
    proposalId: PublicKey
  ) {
    console.log('Thực thi đề xuất:', { 
      multisigAddress: multisigAddress.toBase58(),
      proposalId: proposalId.toBase58()
    });
    return true;
  }
}

// Styles
const styles = {
  container: {
    padding: '20px',
    border: '1px solid #ccc',
    borderRadius: '5px',
    backgroundColor: '#f9f9f9',
    marginBottom: '20px',
  },
  header: {
    fontSize: '1.5rem',
    marginBottom: '15px',
  },
  label: {
    fontWeight: 'bold',
    marginBottom: '5px',
    display: 'block',
  },
  inputGroup: {
    marginBottom: '15px',
  },
  input: {
    width: '100%',
    padding: '8px',
    border: '1px solid #ccc',
    borderRadius: '4px',
  },
  button: {
    backgroundColor: '#4CAF50',
    border: 'none',
    color: 'white',
    padding: '10px 15px',
    textAlign: 'center' as const,
    textDecoration: 'none',
    display: 'inline-block',
    fontSize: '16px',
    margin: '4px 2px',
    cursor: 'pointer',
    borderRadius: '4px',
  },
  buttonSecondary: {
    backgroundColor: '#2196F3',
    border: 'none',
    color: 'white',
    padding: '10px 15px',
    textAlign: 'center' as const,
    textDecoration: 'none',
    display: 'inline-block',
    fontSize: '16px',
    margin: '4px 2px',
    cursor: 'pointer',
    borderRadius: '4px',
  },
  statusMessage: {
    margin: '10px 0',
    padding: '10px',
    borderRadius: '4px',
  },
  success: {
    backgroundColor: '#dff0d8',
    color: '#3c763d',
    border: '1px solid #d6e9c6',
  },
  error: {
    backgroundColor: '#f2dede',
    color: '#a94442',
    border: '1px solid #ebccd1',
  },
  info: {
    backgroundColor: '#d9edf7',
    color: '#31708f',
    border: '1px solid #bce8f1',
  },
  proposalItem: {
    padding: '15px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    marginBottom: '10px',
    backgroundColor: '#fff',
  },
  proposalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  proposalTitle: {
    fontSize: '1.2rem',
    fontWeight: 'bold',
  },
  proposalStatus: {
    padding: '5px 10px',
    borderRadius: '20px',
    color: '#fff',
    fontSize: '0.8rem',
  },
  statusPending: {
    backgroundColor: '#FFA500',
  },
  statusExecuted: {
    backgroundColor: '#4CAF50',
  },
  statusRejected: {
    backgroundColor: '#F44336',
  },
  statusExpired: {
    backgroundColor: '#9E9E9E',
  },
  proposalDetails: {
    marginTop: '10px',
    fontSize: '0.9rem',
  },
  proposalActions: {
    marginTop: '15px',
    display: 'flex',
    gap: '10px',
  },
  approveButton: {
    backgroundColor: '#4CAF50',
    border: 'none',
    color: 'white',
    padding: '8px 12px',
    borderRadius: '4px',
    cursor: 'pointer',
    textAlign: 'center' as const,
    textDecoration: 'none',
    display: 'inline-block',
    fontSize: '16px',
    margin: '4px 2px',
  },
  rejectButton: {
    backgroundColor: '#F44336',
    border: 'none',
    color: 'white',
    padding: '8px 12px',
    borderRadius: '4px',
    cursor: 'pointer',
    textAlign: 'center' as const,
    textDecoration: 'none',
    display: 'inline-block',
    fontSize: '16px',
    margin: '4px 2px',
  },
  executeButton: {
    backgroundColor: '#2196F3',
    border: 'none',
    color: 'white',
    padding: '8px 12px',
    borderRadius: '4px',
    cursor: 'pointer',
    textAlign: 'center' as const,
    textDecoration: 'none',
    display: 'inline-block',
    fontSize: '16px',
    margin: '4px 2px',
  },
  transferInfo: {
    backgroundColor: '#f5f5f5',
    padding: '10px',
    borderRadius: '4px',
    marginTop: '10px',
  },
};

// Props interface
interface MultisigPanelProps {
  credentialId: Uint8Array;
  connection: Connection;
}

// Thêm interface sau các import
interface ProposalResult {
  transaction: Transaction;
  proposalPubkey: PublicKey;
}

export const MultisigPanel: React.FC<MultisigPanelProps> = ({ credentialId, connection }) => {
  const [showTransferForm, setShowTransferForm] = useState<boolean>(false);
  const [showMultisigPanel, setShowMultisigPanel] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');
  const [multisigAddress, setMultisigAddress] = useState<PublicKey | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [proposals, setProposals] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [multisigInfo, setMultisigInfo] = useState<any>(null);
  const [payerKeypair, setPayerKeypair] = useState<any>(null);
  
  // Form state cho tạo đề xuất
  const [showProposalForm, setShowProposalForm] = useState<boolean>(false);
  const [destinationAddress, setDestinationAddress] = useState<string>('');
  const [amount, setAmount] = useState<string>('0.1');
  const [description, setDescription] = useState<string>('Chuyển SOL');

  // Thêm state isUsingFirebase
  const [isUsingFirebase, setIsUsingFirebase] = useState<boolean>(true);

  // Thêm navigate để điều hướng
  const navigate = useNavigate();

  // Khởi tạo
  useEffect(() => {
    const initialize = async () => {
      try {
        setIsLoading(true);
        setStatus('Đang khởi tạo...');
        
        // Debug thông tin môi trường
        console.log("======== THÔNG TIN MÔI TRƯỜNG ========");
        console.log("RPC Endpoint:", process.env.REACT_APP_RPC_ENDPOINT || 'Không được cấu hình');
        console.log("Program ID:", process.env.REACT_APP_PROGRAM_ID || PROGRAM_ID_STRING);
        console.log("Credential ID:", Buffer.from(credentialId).toString('base64'));
        console.log("========================================");
        
        // Kiểm tra chương trình secp256r1
        const isSecp256r1Available = await checkSecp256r1Program();
        if (!isSecp256r1Available) {
          setStatus('Lỗi: Chương trình secp256r1 không có sẵn trên validator!');
          console.error('Chương trình Secp256r1 không khả dụng trên validator!');
          console.error('Vui lòng khởi động validator với: --bpf-program Secp256r1SigVerify1111111111111111111111111');
          setIsLoading(false);
          return;
        }
        setStatus(prev => `${prev}\nChương trình secp256r1 đã sẵn sàng.`);
        
        // Kiểm tra kết nối đến validator
        try {
          const blockHeight = await connection.getBlockHeight();
          console.log("Kết nối thành công đến validator. Block height:", blockHeight);
          setStatus(prev => `${prev}\nĐã kết nối thành công đến validator. Block height: ${blockHeight}`);
        } catch (connError) {
          console.error("Lỗi kết nối đến validator:", connError);
          setStatus(prev => `${prev}\nLỗi kết nối đến validator: ${connError instanceof Error ? connError.message : String(connError)}`);
        }
        
        // Lấy keypair từ env thay vì tạo mới
        const keypair = await getEnvKeypair();
        setPayerKeypair(keypair);
        console.log("Keypair public key:", keypair.publicKey.toString());
        setStatus(prev => `${prev}\nĐã lấy keypair từ môi trường: ${keypair.publicKey.toString()}`);
        
        // Tìm địa chỉ ví multisig ngay cả khi program chưa được khởi tạo
        const credentialIdBase64 = Buffer.from(credentialId).toString('base64');
        
        // Luôn khởi tạo Program, bất kể isUsingFirebase là gì
        let programInstance: Program | null = null;
        try {
          programInstance = await initializeProgram(connection, keypair.publicKey);
          if (programInstance) {
            setProgram(programInstance as any);
            const programId = programInstance.programId.toString();
            console.log("Khởi tạo program thành công:", programId);
            setStatus(prev => `${prev}\nĐã khởi tạo program thành công: ${programId}`);
          } else {
            console.error('Không thể khởi tạo program.');
            setStatus(prev => `${prev}\nKhông thể khởi tạo program. Vui lòng kiểm tra kết nối và file IDL.`);
            setStatus(prev => `${prev}\nĐường dẫn IDL: src/idl/moon_wallet.json`);
            setStatus(prev => `${prev}\nProgram ID: ${PROGRAM_ID_STRING}`);
          }
        } catch (progError) {
          console.error('Lỗi khi khởi tạo program:', progError);
          setStatus(prev => `${prev}\nLỗi khi khởi tạo program: ${progError instanceof Error ? progError.message : String(progError)}`);
        }
        
        // Tìm ví sau khi đã khởi tạo program
        await findWallet(credentialIdBase64, programInstance);
      } catch (error) {
        console.error('Lỗi khi khởi tạo:', error);
        setStatus(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setIsLoading(false);
      }
    };
    
    initialize();
  }, [credentialId, connection]);
  
  // Sửa hàm loadProposalsFromFirebase để tương thích với loadProposals từ multisigUtils
  const loadProposalsFromFirebase = async (multisigPubkey: PublicKey) => {
    try {
      setStatus(prev => `${prev}\nĐang tải đề xuất từ Firebase...`);
      // Sử dụng hàm getProposalsByWallet từ proposalService
      const proposalsData = await getProposalsByWallet(multisigPubkey);
      
      if (proposalsData && Array.isArray(proposalsData)) {
        setProposals(proposalsData);
        setStatus(prev => `${prev}\nĐã tải ${proposalsData.length} đề xuất từ Firebase`);
      } else {
        setStatus(prev => `${prev}\nKhông tìm thấy đề xuất nào trong Firebase`);
      }
    } catch (error) {
      console.error('Lỗi khi tải đề xuất từ Firebase:', error);
      setStatus(prev => `${prev}\nLỗi khi tải đề xuất từ Firebase: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Tìm ví đa chữ ký - sửa đổi để hoạt động cả khi không có Program
  const findWallet = async (credentialIdBase64: string, prog: Program | null) => {
    try {
      setIsLoading(true);
      setStatus('Đang tìm ví đa chữ ký...');
      
      const credentialIdHex = Buffer.from(credentialIdBase64, 'base64').toString('hex');
      
      // Thử tìm ví từ credential ID
      let result = await findMultisigWallet(credentialIdBase64, prog as any, {
        onProgress: msg => setStatus(prev => `${prev}\n${msg}`),
        onError: err => setStatus(prev => `${prev}\nLỗi: ${err}`),
        onSuccess: async data => {
          setMultisigInfo(data);
          if (data.address) {
            const address = data.address.toString();
            setMultisigAddress(new PublicKey(address));
            
            // Lưu địa chỉ vào localStorage
            localStorage.setItem('multisigWalletAddress', address);
          
          // Thêm log để hiển thị thông tin threshold
          if (data.threshold !== undefined) {
            console.log(`Đã tìm thấy thông tin ngưỡng ký: ${data.threshold}`);
            setStatus(prev => `${prev}\nĐã tìm thấy ví đa chữ ký: ${address}\nNgưỡng ký: ${data.threshold}`);
            
            // Lưu threshold vào Firebase nếu đã tìm thấy từ blockchain
            try {
              // Import hàm updateWalletThreshold
              const { updateWalletThreshold } = await import('../firebase/webAuthnService');
              const updated = await updateWalletThreshold(
                credentialIdHex,
                address,
                data.threshold
              );
              
              if (updated) {
                console.log('Đã lưu ngưỡng ký vào Firebase thành công:', data.threshold);
              } else {
                console.warn('Không thể lưu ngưỡng ký vào Firebase');
              }
            } catch (error) {
              console.error('Lỗi khi lưu ngưỡng ký vào Firebase:', error);
            }
          } else {
            console.warn("CẢNH BÁO: Không tìm thấy thông tin ngưỡng ký!");
            setStatus(prev => `${prev}\nĐã tìm thấy ví đa chữ ký: ${address}\nCẢNH BÁO: Không tìm thấy thông tin ngưỡng ký!`);
          }
          
          // Hiển thị form multisig khi tìm thấy ví
          setShowMultisigPanel(true);
          
          // Mặc định hiển thị form chuyển tiền khi tìm thấy ví
          setShowTransferForm(true);
          
            // Nếu tìm thấy và có program, tải danh sách đề xuất
          if (data.pubkey && prog) {
            loadMultisigProposals(data.pubkey, prog);
            } 
            // Nếu không có program nhưng đang sử dụng Firebase
            else if (isUsingFirebase && data.pubkey) {
              loadProposalsFromFirebase(data.pubkey);
            }
          }
        }
      });
      
      // Nếu không tìm thấy qua credential ID, thử tìm thông qua Firebase
      if (!result && isUsingFirebase) {
        setStatus(prev => `${prev}\nKhông tìm thấy ví qua credential ID, đang kiểm tra trong Firebase...`);
        
        // Lấy thông tin từ Firebase
        const credentialMapping = await getWalletByCredentialId(credentialIdHex);
        
        if (credentialMapping && credentialMapping.walletAddress) {
          const walletAddress = credentialMapping.walletAddress;
          const multisigPubkey = new PublicKey(walletAddress);
          
          setMultisigAddress(multisigPubkey);
          localStorage.setItem('multisigWalletAddress', walletAddress);
          
          setStatus(prev => `${prev}\nĐã tìm thấy ví đa chữ ký từ Firebase: ${walletAddress}`);
          setShowMultisigPanel(true);
          setShowTransferForm(true);
          
          if (credentialMapping.threshold !== undefined) {
            setMultisigInfo({
              pubkey: multisigPubkey,
              account: null,
              address: walletAddress,
              threshold: credentialMapping.threshold
            });
          }
          
          // Tải đề xuất từ Firebase vì không có program
          loadProposalsFromFirebase(multisigPubkey);
          
          result = {
            pubkey: multisigPubkey,
            account: null,
            address: walletAddress
          };
        }
      }
      
      return result;
    } catch (error) {
      console.error('Lỗi khi tìm ví đa chữ ký:', error);
      setStatus(prev => `${prev}\nLỗi khi tìm ví đa chữ ký: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      setIsLoading(false);
    }
  };
  
  // Sửa đổi hàm loadMultisigProposals để hoạt động với Firebase nếu không có Program
  const loadMultisigProposals = async (multisigPubkey: PublicKey, prog: Program | null) => {
    try {
      setStatus(prev => `${prev}\nĐang tải danh sách đề xuất...`);
      
      // Nếu không có program nhưng đang sử dụng Firebase
      if (!prog && isUsingFirebase) {
        loadProposalsFromFirebase(multisigPubkey);
        return;
      }
      
      // Nếu có Program, tải đề xuất từ blockchain
      if (prog) {
        const proposals = await loadProposals(multisigPubkey, prog as any);
        if (proposals) {
          setProposals(proposals);
          setStatus(prev => `${prev}\nĐã tải ${proposals.length} đề xuất`);
        }
      }
    } catch (error) {
      console.error('Lỗi khi tải đề xuất:', error);
      setStatus(prev => `${prev}\nLỗi khi tải đề xuất: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // Tạo đề xuất giao dịch
  const handleCreateProposal = async () => {
    try {
      setIsLoading(true);
      setStatus('Đang tạo đề xuất giao dịch...');
      
      // Kiểm tra đầu vào
      if (!destinationAddress) {
        throw new Error('Vui lòng nhập địa chỉ đích');
      }
      
      if (!amount || parseFloat(amount) <= 0) {
        throw new Error('Vui lòng nhập số lượng SOL hợp lệ');
      }
      
      if (!multisigAddress || !payerKeypair) {
        throw new Error('Vui lòng đảm bảo ví đa chữ ký và keypair đã được khởi tạo');
      }

      // Kiểm tra ngưỡng ký
      let thresholdValue = multisigInfo?.threshold;
      
      // Nếu chưa có threshold, thử lấy từ Firebase
      if (thresholdValue === undefined) {
        try {
          // Chuyển đổi credentialId từ Uint8Array sang string hex
          const credentialIdHex = Buffer.from(credentialId).toString('hex');
          console.log('CredentialId hex (để lấy threshold):', credentialIdHex);
          
          // Thử tìm threshold trong Firebase
          const credentialMapping = await getWalletByCredentialId(credentialIdHex);
          
          if (credentialMapping && credentialMapping.threshold !== undefined) {
            thresholdValue = credentialMapping.threshold;
            console.log(`Đã lấy được ngưỡng ký từ Firebase: ${thresholdValue}`);
          } else {
            throw new Error('Không tìm thấy thông tin ngưỡng ký trong Firebase');
          }
        } catch (error) {
          console.error('Lỗi khi lấy threshold từ Firebase:', error);
          throw new Error('Không thể lấy thông tin ngưỡng ký từ ví đa chữ ký. Vui lòng làm mới trang và thử lại.');
        }
      } else {
        console.log(`Sử dụng ngưỡng ký từ multisigInfo: ${thresholdValue}`);
      }
      
      if (thresholdValue === undefined) {
        throw new Error('Không thể lấy thông tin ngưỡng ký từ ví đa chữ ký. Vui lòng làm mới trang và thử lại.');
      }
      
      // Kiểm tra program - luôn phải có program cho giao dịch trên blockchain
      if (!program) {
        throw new Error("Không tìm thấy program trên blockchain. Vui lòng khởi động lại ứng dụng và thử lại.");
      }
      
      setStatus(prev => `${prev}\nĐang yêu cầu xác thực WebAuthn...`);
      
      // LẤY WEBAUTHN PUBLIC KEY TỪ FIREBASE
      console.log('Lấy WebAuthn public key...');
      let webAuthnPubKey: Buffer;
      
      // Chuyển đổi credentialId từ Uint8Array sang string hex
      const credentialIdHex = Buffer.from(credentialId).toString('hex');
      console.log('CredentialId hex:', credentialIdHex);
      
      // Thử tìm trong Firebase
      const credentialMapping = await getWalletByCredentialId(credentialIdHex);
      
      if (!credentialMapping || !credentialMapping.guardianPublicKey || credentialMapping.guardianPublicKey.length === 0) {
        // Thử tìm trong localStorage
        console.log('Không tìm thấy trong Firebase, thử tìm trong localStorage...');
        const localStorageData = localStorage.getItem('webauthn_credential_' + credentialIdHex);
        if (localStorageData) {
          const localMapping = JSON.parse(localStorageData);
          if (localMapping && localMapping.guardianPublicKey && localMapping.guardianPublicKey.length > 0) {
            webAuthnPubKey = Buffer.from(new Uint8Array(localMapping.guardianPublicKey));
          } else {
            throw new Error('Không tìm thấy WebAuthn public key trong localStorage');
          }
        } else {
          throw new Error('Không tìm thấy WebAuthn public key');
        }
      } else {
        // Sử dụng WebAuthn public key từ Firebase
        webAuthnPubKey = Buffer.from(new Uint8Array(credentialMapping.guardianPublicKey));
      }
      
      console.log('Đã lấy được WebAuthn public key thật:', webAuthnPubKey.toString('hex'));
      
      // 1. Lấy xác thực WebAuthn - đảm bảo hoạt động đúng với chữ ký
      const credentialIdString = Buffer.from(credentialId).toString('hex');
      console.log("Yêu cầu chữ ký với credential ID:", credentialIdString);
      
      const assertion = await getWebAuthnAssertion(credentialIdString, undefined, true);
      if (!assertion) {
        throw new Error("Không thể lấy WebAuthn assertion");
      }
      
      console.log("Đã nhận WebAuthn assertion:", assertion);
      setStatus(prev => `${prev}\nĐã lấy xác thực WebAuthn thành công.`);
      
      // Tiếp tục quá trình tạo đề xuất trên blockchain
      try {
        // 2. Chuẩn bị message và tạo instruction secp256r1
        const timestamp = Math.floor(Date.now() / 1000);
        const amountStr = parseFloat(amount).toString();
        
        // Tính hash của webAuthnPubKey
        console.log('===== DEBUG HASH CALCULATION =====');
        console.log('Hash Function Input (exact param):', webAuthnPubKey.toString('hex'));
        console.log('Hash Function Input Type:', webAuthnPubKey.constructor.name);
        console.log('Hash Function Input Bytes:', Array.from(webAuthnPubKey));
        
        // Tính hash sử dụng sha256 giống contract
        const hashBytes = sha256(Buffer.from(webAuthnPubKey));
        const fullHashHex = Buffer.from(hashBytes).toString('hex');
        console.log('Full SHA-256 Hash (Hex):', fullHashHex);
        
        // Lấy 6 bytes đầu tiên của hash
        const hashBytesStart = hashBytes.slice(0, 6);
        
        // Chuyển đổi sang hex string giống hàm to_hex trong contract
        const pubkeyHashHex = Array.from(hashBytesStart as Uint8Array)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        
        console.log('First 6 bytes of Hash (12 hex chars):', pubkeyHashHex);
        
        // Tạo message với đầy đủ thông tin bao gồm pubkey hash
        const messageString = `create:proposal_transfer_${amountStr}_SOL_to_${destinationAddress},timestamp:${timestamp},pubkey:${pubkeyHashHex}`;
        
        console.log("Message đầy đủ để ký:", messageString);
        
        // Chuyển đổi chữ ký DER sang raw
        const signatureRaw = derToRaw(assertion.signature);
        const signatureBuffer = Buffer.from(signatureRaw);
        
        console.log("Signature (raw):", signatureBuffer.toString('hex'));
        
        // Chuẩn hóa signature về dạng Low-S
        const normalizedSignature = normalizeSignatureToLowS(Buffer.from(signatureRaw));
        console.log("Normalized signature:", normalizedSignature.toString('hex'));
        
        // Chuẩn bị dữ liệu xác thực WebAuthn đúng cách
        console.log('Tạo verification data WebAuthn...');
        const verificationData = await createWebAuthnVerificationData(assertion);
        
        console.log('Verification data length:', verificationData.length);
        console.log('Verification data (hex):', Buffer.from(verificationData).toString('hex'));
        
        // Tạo secp256r1 instruction - sử dụng verificationData
        const secp256r1Instruction = createSecp256r1Instruction(
          Buffer.from(verificationData),
          webAuthnPubKey,
          normalizedSignature,
          false
        );
        
        // Tạo proposal ID dựa trên timestamp hiện tại
        const proposalId = new BN(Date.now());
        
        setStatus(prev => `${prev}\nĐang chuẩn bị tạo đề xuất trên blockchain...`);
        
        // Đảm bảo multisigAddress là đối tượng PublicKey hợp lệ
        const multisigPDAObj = new PublicKey(multisigAddress.toString());
        console.log("MultisigPDA được chuyển đổi:", multisigPDAObj.toString());
        
        // Lấy guardianId từ credential mapping
        const guardianId = credentialMapping?.guardianId || 1;
        console.log("Guardian ID:", guardianId);
        
        // Tạo tham số cho đề xuất
        const destinationPubkey = new PublicKey(destinationAddress);
        const amountLamports = new BN(parseFloat(amount) * LAMPORTS_PER_SOL);
        
        // Tạo transaction với Anchor program
        const result = await program.methods
          .createProposal(
            proposalId, 
            description,
            new BN(guardianId), 
            "transfer",
            {
              amount: amountLamports,
              destination: destinationPubkey,
              tokenMint: null
            }
          )
          .accounts({
            multisig: multisigPDAObj,
            proposer: payerKeypair.publicKey,
          })
          .transaction();
        
        // Đặt các tham số cho transaction
        const transaction = new Transaction();
        transaction.add(secp256r1Instruction); // Thêm instruction xác thực WebAuthn trước
        transaction.add(result.instructions[0]); // Thêm instruction tạo đề xuất sau
        
        // Thiết lập fee payer và recent blockhash
        transaction.feePayer = payerKeypair.publicKey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        
        // Ký và gửi giao dịch
        transaction.sign(payerKeypair);
        
        setStatus(prev => `${prev}\nĐang gửi giao dịch tạo đề xuất lên blockchain...`);
        console.log("Gửi transaction tạo đề xuất:", transaction);
        
        // Tính PDA cho proposal để lấy địa chỉ
        const [proposalPubkey] = await PublicKey.findProgramAddressSync(
          [
            Buffer.from('proposal'),
            multisigPDAObj.toBuffer(),
            proposalId.toArrayLike(Buffer, 'le', 8),
          ],
          PROGRAM_ID
        );
        
        // Gửi transaction
        try {
          const signature = await connection.sendTransaction(transaction, [payerKeypair], {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
            maxRetries: 3
          });
          
          // Đợi xác nhận giao dịch
          await connection.confirmTransaction(signature, 'confirmed');
          
          // Lưu thông tin đề xuất vào Firebase để hiển thị
          const proposalData = {
            proposalId: proposalId.toNumber(),
            multisigAddress: multisigPDAObj.toString(),
            description: description,
            action: 'transfer',
            status: 'pending',
            createdAt: Timestamp.now(),
            creator: payerKeypair.publicKey.toString(),
            signers: [guardianId.toString()], // Người tạo đề xuất đã ký
            requiredSignatures: thresholdValue,
            destination: destinationPubkey.toString(),
            amount: amountLamports.toNumber(),
            tokenMint: null,
            transactionSignature: signature
          };
          
          console.log("Lưu proposal vào Firebase:", proposalData);
          
          try {
            // Sử dụng service để lưu đề xuất
            const docId = await createProposal(proposalData);
            console.log("Đã lưu proposal vào Firebase thành công, ID:", docId);
          } catch (firebaseError) {
            console.error("Lỗi khi lưu proposal vào Firebase:", firebaseError);
            // Không throw error ở đây vì transaction đã thành công
          }
          
          setStatus(`Đã tạo đề xuất thành công trên blockchain và lưu vào Firebase! Signature: ${signature}`);
          setShowProposalForm(false);
          
          // Lưu proposalId vào localStorage để sử dụng sau này
          localStorage.setItem('lastCreatedProposalId', proposalId.toString());
          
          // Tải lại danh sách đề xuất 
          if (multisigAddress) {
            loadMultisigProposals(multisigPDAObj, program);
          }
          
          // Chuyển hướng đến trang danh sách đề xuất
          setTimeout(() => {
            goToProposalList();
          }, 2000);
        } catch (sendError: any) {
          console.error("Lỗi khi gửi giao dịch:", sendError);
          
          // Lấy logs từ kết quả simulation nếu có
          let logs: string[] = [];
          if (sendError.logs) {
            logs = sendError.logs;
            console.error("Logs đầy đủ từ blockchain:", logs);
          }
          
          // Phân tích thông tin lỗi để hiển thị thông báo cụ thể
          let errorDetail = "Lỗi không xác định";
          
          if (logs.length > 0) {
            // Hiển thị logs chi tiết trong UI
            errorDetail = "Lỗi từ chương trình Solana:\n\n" + logs.join('\n');
          } else if (sendError.message.includes("custom program error: 0x")) {
            // Phân tích mã lỗi custom program
            if (sendError.message.includes("custom program error: 0x2")) {
              errorDetail = "Lỗi tham số không hợp lệ (custom program error: 0x2). Có thể do:";
              errorDetail += "\n- Sai địa chỉ đích";
              errorDetail += "\n- Sai số lượng SOL";
              errorDetail += "\n- Guardian không có quyền tạo đề xuất";
            } else if (sendError.message.includes("custom program error: 0x1")) {
              errorDetail = "Lỗi khởi tạo sai (custom program error: 0x1)";
            } else if (sendError.message.includes("custom program error: 0x3")) {
              errorDetail = "Lỗi đề xuất đã tồn tại (custom program error: 0x3)";
            } else {
              // Trích xuất mã lỗi
              const errorMatch = sendError.message.match(/custom program error: (0x[0-9a-fA-F]+)/);
              if (errorMatch && errorMatch[1]) {
                errorDetail = `Lỗi chương trình: ${errorMatch[1]}`;
              } else {
                errorDetail = `Lỗi: ${sendError.message}`;
              }
            }
          } else {
            errorDetail = `Lỗi: ${sendError.message}`;
          }
          
          setStatus(`Giao dịch thất bại: ${errorDetail}`);
          throw new Error(errorDetail);
        }
      } catch (error) {
        console.error("Lỗi khi xử lý WebAuthn và tạo đề xuất:", error);
        setStatus(prev => `${prev}\nLỗi khi xử lý WebAuthn và tạo đề xuất: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    } catch (error) {
      console.error('Lỗi khi tạo đề xuất:', error);
      setStatus(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Hàm định dạng trạng thái đề xuất
  const formatProposalStatus = (status: string) => {
    switch (status) {
      case 'Pending':
        return 'Đang chờ';
      case 'Executed':
        return 'Đã thực thi';
      case 'Rejected':
        return 'Đã từ chối';
      case 'Expired':
        return 'Đã hết hạn';
      default:
        return status;
    }
  };
  
  // Hàm định dạng địa chỉ ngắn gọn
  const formatAddress = (address: string) => {
    if (!address) return '';
    return `${address.substring(0, 4)}...${address.substring(address.length - 4)}`;
  };
  
  // Hiển thị form transfer nếu đã đăng nhập thành công
  const toggleTransferForm = () => {
    setShowTransferForm(!showTransferForm);
  };

  // Hàm điều hướng đến trang danh sách đề xuất
  const goToProposalList = () => {
    // Nếu có multisigAddress, truyền vào url để trang proposals có thể lọc theo ví
    if (multisigAddress) {
      navigate(`/proposals?wallet=${multisigAddress.toString()}`);
    } else {
    navigate('/proposals');
    }
  };

  // Khi tìm thấy multisig address thành công, lưu vào localStorage
  useEffect(() => {
    if (multisigAddress) {
      // Lưu địa chỉ ví vào localStorage để sử dụng ở các trang khác
      localStorage.setItem('multisigWalletAddress', multisigAddress.toString());
      console.log("MultisigPanel: Đã lưu địa chỉ ví vào localStorage:", multisigAddress.toString());
    }
  }, [multisigAddress]);

  // Hàm định dạng thời gian tạo
  const formatCreatedAt = (createdAt: any): string => {
    if (!createdAt) return 'Không xác định';
    
    // Kiểm tra nếu là timestamp của Firebase (có thuộc tính seconds và nanoseconds)
    if (createdAt && typeof createdAt === 'object' && 'seconds' in createdAt && 'nanoseconds' in createdAt) {
      // Chuyển đổi timestamp thành Date
      const date = new Date(createdAt.seconds * 1000 + createdAt.nanoseconds / 1000000);
      return date.toLocaleString('vi-VN');
    }
    
    // Trường hợp là một đối tượng Date
    if (createdAt instanceof Date) {
      return createdAt.toLocaleString('vi-VN');
    }
    
    // Trường hợp là một timestamp dạng số
    if (typeof createdAt === 'number') {
      return new Date(createdAt).toLocaleString('vi-VN');
    }
    
    // Trường hợp đã là string
    return String(createdAt);
  };

  // Обновить отображение данных предложений
  const renderProposals = () => {
    if (proposals.length === 0) {
      return (
        <div style={styles.proposalItem}>
          <p>Chưa có đề xuất nào.</p>
        </div>
      );
    }

    return proposals.map((proposal, index) => (
      <div key={index} style={styles.proposalItem}>
        <div style={styles.proposalHeader}>
          <h3>{proposal.description}</h3>
          <span style={getStatusStyle(proposal.status)}>{proposal.status}</span>
        </div>
        <p><strong>ID:</strong> {proposal.id}</p>
        <p><strong>Hành động:</strong> {proposal.action}</p>
        {proposal.destination && (
          <p><strong>Đích:</strong> {formatAddress(proposal.destination)}</p>
        )}
        {proposal.amount && (
          <p><strong>Số lượng:</strong> {proposal.amount} SOL</p>
        )}
        <p><strong>Chữ ký:</strong> {proposal.signaturesCount || 0}/{proposal.requiredSignatures || 0}</p>
        <p><strong>Thời gian tạo:</strong> {formatCreatedAt(proposal.createdAt)}</p>
        
        <div style={{ marginTop: '10px' }}>
          {proposal.status === 'Pending' && (
            <>
              <button 
                style={styles.buttonSecondary}
                onClick={() => console.log('Chức năng phê duyệt đề xuất tạm thời vô hiệu hóa')}
              >
                Phê duyệt
              </button>
              <button 
                style={{...styles.buttonSecondary, backgroundColor: '#f44336'}}
                onClick={() => console.log('Chức năng từ chối đề xuất tạm thời vô hiệu hóa')}
              >
                Từ chối
              </button>
            </>
          )}
          {proposal.status === 'Approved' && (
            <button 
              style={styles.button}
              onClick={() => console.log('Chức năng thực thi đề xuất tạm thời vô hiệu hóa')}
            >
              Thực thi
            </button>
          )}
        </div>
      </div>
    ));
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.header}>Ví Đa Chữ Ký</h2>
      
      {isLoading ? (
        <p>Đang tải...</p>
      ) : (
        <>
          {status && (
            <div style={{...styles.statusMessage, ...styles.info}}>
              <pre>{status}</pre>
            </div>
          )}
          
          {showMultisigPanel && multisigAddress && (
            <>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Địa chỉ ví:</label>
                <div>{multisigAddress.toString()}</div>
              </div>
              
              <div style={styles.inputGroup}>
                <button 
                  style={styles.button}
                  onClick={toggleTransferForm}
                >
                  {showTransferForm ? 'Ẩn Form Chuyển Tiền' : 'Hiện Form Chuyển Tiền'}
                </button>
                
                {/* Thêm nút để chuyển đến trang danh sách đề xuất */}
                <button 
                  style={{...styles.button, marginLeft: '10px', backgroundColor: '#4CAF50'}}
                  onClick={goToProposalList}
                >
                  Xem Danh Sách Đề Xuất
                </button>
              </div>
              
              {showTransferForm && (
                <div style={{border: '1px solid #ddd', padding: '15px', marginTop: '15px'}}>
                  <h3>Chuyển Tiền</h3>
                  <div style={styles.inputGroup}>
                    <label style={styles.label}>Địa chỉ nhận:</label>
                    <input
                      type="text"
                      style={styles.input}
                      value={destinationAddress}
                      onChange={(e) => setDestinationAddress(e.target.value)}
                      placeholder="Địa chỉ ví nhận SOL"
                    />
                  </div>
                  
                  <div style={styles.inputGroup}>
                    <label style={styles.label}>Số lượng SOL:</label>
                    <input
                      type="text"
                      style={styles.input}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="Số lượng SOL"
                    />
                  </div>
                  
                  <div style={styles.inputGroup}>
                    <label style={styles.label}>Mô tả:</label>
                    <input
                      type="text"
                      style={styles.input}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Mô tả giao dịch"
                    />
                  </div>
                  
                  <button
                    style={styles.button}
                    onClick={handleCreateProposal}
                    disabled={isLoading}
                  >
                    Tạo Đề Xuất Chuyển Tiền
                  </button>
                </div>
              )}
              
              {proposals.length > 0 && (
                <div style={{marginTop: '20px'}}>
                  <h3>Danh Sách Đề Xuất</h3>
                  {renderProposals()}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

// Helper function để lấy style cho trạng thái đề xuất
const getStatusStyle = (status: string) => {
  switch(status) {
    case 'Pending': return styles.statusPending;
    case 'Executed': return styles.statusExecuted;
    case 'Rejected': return styles.statusRejected;
    case 'Expired': return styles.statusExpired;
    default: return {};
  }
}; 