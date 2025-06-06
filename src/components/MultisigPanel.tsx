import React, { useState, useEffect } from 'react';
import { PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction, Connection, TransactionInstruction } from '@solana/web3.js';
import { Program, BN } from '@coral-xyz/anchor';
import {
  findMultisigWallet,
  loadProposals,
  initializeProgram,
  getEnvKeypair
} from '../utils/multisig/multisigUtils';
import { connection } from '../config/solana';
import { getWebAuthnAssertion, createWebAuthnVerificationData } from '../utils/webauthnUtils';
import { 
  createSecp256r1Instruction,
  checkSecp256r1Program,
  derToRaw,
  SYSVAR_CLOCK_PUBKEY
} from '../utils/transactionUtils';
import { createActionParams } from '../utils/types';
import { getWalletByCredentialId } from '../firebase/webAuthnService';
import { getGuardianPDA } from '../utils/credentialUtils';
import { PROGRAM_ID } from '../utils/constants';
import { Timestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { createProposal, addSignerToProposal, updateProposalStatus, getProposalsByWallet, updateProposalWithSigningLink } from '../firebase/proposalService';
import { sha256 } from '@noble/hashes/sha256';
import { QRCodeSVG as QRCode } from 'qrcode.react';

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
}

export const MultisigPanel: React.FC<MultisigPanelProps> = ({ credentialId }) => {
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

  // State cho việc hiển thị QR code và link ký đề xuất
  const [proposalSigningLink, setProposalSigningLink] = useState<string>('');
  const [showProposalQR, setShowProposalQR] = useState<boolean>(false);

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
        await findWallet(credentialIdBase64, null);
        
        // Nếu không sử dụng Firebase, cần khởi tạo Program
        if (!isUsingFirebase) {
        let programInstance: Program | null = null;
        // Khởi tạo program
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
        } else {
          console.log("Sử dụng Firebase để quản lý dữ liệu, bỏ qua khởi tạo Program Anchor");
          setStatus(prev => `${prev}\nSử dụng Firebase để quản lý dữ liệu, bỏ qua khởi tạo Program Anchor`);
        }
        
      } catch (error) {
        console.error('Lỗi khi khởi tạo:', error);
        setStatus(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setIsLoading(false);
      }
    };
    
    initialize();
  }, [credentialId, connection, isUsingFirebase]);
  
  // Thêm hàm loadProposalsFromFirebase để tải đề xuất từ Firebase
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
  
  // Tìm ví đa chữ ký
  const findWallet = async (credentialIdBase64: string, prog: Program | null) => {
    try {
      setIsLoading(true);
      setStatus('Đang tìm ví đa chữ ký...');
      
      const credentialIdHex = Buffer.from(credentialIdBase64, 'base64').toString('hex');
      
      let result = await findMultisigWallet(credentialIdBase64, prog as any, {
        onProgress: msg => setStatus(prev => `${prev}\n${msg}`),
        onError: err => setStatus(prev => `${prev}\nLỗi: ${err}`),
        onSuccess: data => {
          setMultisigInfo(data);
          setMultisigAddress(data.address);
          
          // Thêm log để hiển thị thông tin threshold
          if (data.threshold !== undefined) {
            console.log(`Đã tìm thấy thông tin ngưỡng ký: ${data.threshold}`);
            setStatus(prev => `${prev}\nĐã tìm thấy ví đa chữ ký: ${data.address}\nNgưỡng ký: ${data.threshold}`);
          } else {
            console.warn("CẢNH BÁO: Không tìm thấy thông tin ngưỡng ký!");
            setStatus(prev => `${prev}\nĐã tìm thấy ví đa chữ ký: ${data.address}\nCẢNH BÁO: Không tìm thấy thông tin ngưỡng ký!`);
          }
          
          // Hiển thị form multisig khi tìm thấy ví
          setShowMultisigPanel(true);
          
          // Mặc định hiển thị form chuyển tiền khi tìm thấy ví
          setShowTransferForm(true);
          
          // Nếu tìm thấy, tải danh sách đề xuất
          if (data.pubkey && prog) {
            loadMultisigProposals(data.pubkey, prog);
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
      console.error('Lỗi khi tìm ví:', error);
      setStatus(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      setIsLoading(false);
    }
  };
  
  // Tải danh sách đề xuất
  const loadMultisigProposals = async (multisigPubkey: PublicKey, prog: Program | null) => {
    try {
      setIsLoading(true);
      setStatus('Đang tải danh sách đề xuất...');
      
      // Nếu không có program nhưng đang sử dụng Firebase
      if (!prog && isUsingFirebase) {
        loadProposalsFromFirebase(multisigPubkey);
        return;
      }
      
      await loadProposals(multisigPubkey, {
        onProgress: msg => setStatus(prev => `${prev}\n${msg}`),
        onError: err => setStatus(`Lỗi: ${err}`),
        onSuccess: data => {
          setProposals(data);
          setStatus(prev => `${prev}\nĐã tải ${data.length} đề xuất.`);
          
          // Tải lại danh sách đề xuất
          if (prog && multisigInfo?.pubkey) {
            setTimeout(() => {
              loadMultisigProposals(multisigInfo.pubkey, prog);
            }, 2000);
          }
        }
      });
    } catch (error) {
      console.error('Lỗi khi tải đề xuất:', error);
      setStatus(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
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
      
      setStatus(prev => `${prev}\nĐang yêu cầu xác thực WebAuthn...`);
      
      // LẤY WEBAUTHN PUBLIC KEY THẬT TỪ FIREBASE
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
        
        // Thêm debug để kiểm tra từng byte hash
        console.log('Hash bytes (first 6):', Array.from(hashBytesStart as Uint8Array));
        console.log('Hash hex format with contract matching:');
        Array.from(hashBytesStart as Uint8Array).forEach((byte, i) => {
          const hex = byte.toString(16).padStart(2, '0');
          console.log(`Byte ${i}: ${byte} -> hex: ${hex}`);
        });
        console.log('==============================================');
        
        // Tạo message với đầy đủ thông tin bao gồm pubkey hash
        const messageString = `create:proposal_transfer_${amountStr}_SOL_to_${destinationAddress},timestamp:${timestamp},pubkey:${pubkeyHashHex}`;
        const message = Buffer.from(messageString);
        
        console.log("Message đầy đủ để ký:", messageString);
        
        // Chuyển đổi chữ ký DER sang raw
        const signatureRaw = derToRaw(assertion.signature);
        const signatureBuffer = Buffer.from(signatureRaw);
        
        console.log("Signature (raw):", signatureBuffer.toString('hex'));
        
        // Chuẩn hóa signature về dạng Low-S
        const normalizedSignature = normalizeSignatureToLowS(Buffer.from(signatureRaw));
        console.log("Normalized signature:", normalizedSignature.toString('hex'));
        
        // Thêm log để debug giá trị publicKeyBytes
        console.log("KIỂM TRA PUBLIC KEY TRƯỚC KHI TẠO INSTRUCTION:");
        console.log("webAuthnPubKey:", webAuthnPubKey.toString('hex'));
        console.log("webAuthnPubKey length:", webAuthnPubKey.length);
        
        // Chuẩn bị dữ liệu xác thực WebAuthn đúng cách
        console.log('Tạo verification data WebAuthn...');
        const verificationData = await createWebAuthnVerificationData(assertion);
        
        console.log('Verification data length:', verificationData.length);
        console.log('Verification data (hex):', Buffer.from(verificationData).toString('hex'));
        
        // 4. Tạo secp256r1 instruction - sử dụng verificationData thay vì message
        const secp256r1Instruction = createSecp256r1Instruction(
          Buffer.from(verificationData), // Sử dụng verificationData thay vì message
          webAuthnPubKey,
          normalizedSignature,
          false
        );
        
        // 5. Thay thế phần gọi hàm createProposal với trực tiếp tạo và gửi transaction
        setStatus(prev => `${prev}\nĐang tạo transaction với secp256r1 instruction...`);
        
        try {
          // Tạo proposal ID dựa trên timestamp hiện tại
          const proposalId = new BN(Date.now());
          
          // Chuyển đổi guardianId
          const guardianId = new BN(1); // Mặc định là 1 (owner)
          
          // Đảm bảo multisigAddress là đối tượng PublicKey hợp lệ
          const multisigPDAObj = new PublicKey(multisigAddress.toString());
          console.log("MultisigPDA được chuyển đổi:", multisigPDAObj.toString());
          
          // Tính PDA cho guardian
          const guardianPubkey = await getGuardianPDA(multisigPDAObj, guardianId.toNumber());
          
          // Tính PDA cho proposal
          const [proposalPubkey] = await PublicKey.findProgramAddressSync(
            [
              Buffer.from('proposal'),
              multisigPDAObj.toBuffer(),
              proposalId.toArrayLike(Buffer, 'le', 8),
            ],
            PROGRAM_ID
          );
          
          // Tạo tham số cho đề xuất
          const destinationPubkey = new PublicKey(destinationAddress);
          const amountLamports = new BN(parseFloat(amount) * LAMPORTS_PER_SOL);
          
          // Sử dụng hàm createActionParams để tạo ActionParams theo định dạng chuẩn
          const actionParams = createActionParams(
            amountLamports,
            destinationPubkey,
            undefined // Sử dụng undefined thay vì null
          );
          
          console.log("ActionParams:", actionParams);
          
          // Tạo transaction mới và thêm secp256r1 instruction trước tiên
        const transaction = new Transaction();
        transaction.add(secp256r1Instruction);
        
          // Sử dụng discriminator từ IDL
          const createProposalDiscriminator = new Uint8Array([132, 116, 68, 174, 216, 160, 198, 22]);
          
          console.log("Đang sử dụng discriminator từ IDL:", Buffer.from(createProposalDiscriminator).toString('hex'));
          
          // Tạo và encode dữ liệu theo định dạng Anchor
          
          // 1. Discriminator (8 bytes)
          const parts = [Buffer.from(createProposalDiscriminator)];
          
          // 2. proposal_id (u64 - 8 bytes)
          parts.push(Buffer.from(proposalId.toArrayLike(Buffer, 'le', 8)));
          
          // 3. description (string - 4 byte độ dài + nội dung)
          const descriptionBuffer = Buffer.from(description);
          const descriptionLenBuffer = Buffer.alloc(4);
          descriptionLenBuffer.writeUInt32LE(descriptionBuffer.length, 0);
          parts.push(descriptionLenBuffer);
          parts.push(descriptionBuffer);
          
          // 4. proposer_guardian_id (u64 - 8 bytes)
          parts.push(Buffer.from(guardianId.toArrayLike(Buffer, 'le', 8)));
          
          // 5. action (string - 4 byte độ dài + nội dung)
          const actionBuffer = Buffer.from('transfer');
          const actionLenBuffer = Buffer.alloc(4);
          actionLenBuffer.writeUInt32LE(actionBuffer.length, 0);
          parts.push(actionLenBuffer);
          parts.push(actionBuffer);
          
          // 6. params (ActionParams)
          // 6.1. amount (option<u64>)
          if (actionParams.amount) {
            parts.push(Buffer.from([1])); // Some variant
            parts.push(Buffer.from(actionParams.amount.toArrayLike(Buffer, 'le', 8)));
          } else {
            parts.push(Buffer.from([0])); // None variant
          }
          
          // 6.2. destination (option<publicKey>)
          if (actionParams.destination) {
            parts.push(Buffer.from([1])); // Some variant
            parts.push(Buffer.from(actionParams.destination.toBuffer()));
          } else {
            parts.push(Buffer.from([0])); // None variant
          }
          
          // 6.3. tokenMint (option<publicKey>)
          if (actionParams.tokenMint) {
            parts.push(Buffer.from([1])); // Some variant
            parts.push(Buffer.from(actionParams.tokenMint.toBuffer()));
          } else {
            parts.push(Buffer.from([0])); // None variant
          }
          
          // Nối tất cả các phần lại để tạo thành data instruction hoàn chỉnh
          const data = Buffer.concat(parts);
          
          console.log("Instruction data length:", data.length);
          console.log("Instruction data (first 32 bytes):", Buffer.from(data.slice(0, 32)).toString('hex'));
          
          // Thêm instruction vào transaction
          transaction.add(
            new TransactionInstruction({
              keys: [
                { pubkey: multisigPDAObj, isSigner: false, isWritable: true },
                { pubkey: proposalPubkey, isSigner: false, isWritable: true },
                { pubkey: guardianPubkey, isSigner: false, isWritable: false }, // proposer_guardian
                { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
              ],
              programId: PROGRAM_ID,
              data,
            })
          );
          
          // Gửi transaction
          transaction.feePayer = payerKeypair.publicKey;
          transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
          transaction.sign(payerKeypair);
          
          setStatus(prev => `${prev}\nĐang gửi giao dịch với 2 instructions...`);
          console.log("Gửi transaction với 2 instructions:", transaction);
          
          // Kiểm tra instruction bytes
          console.log("Kiểm tra instruction 0 (secp256r1):", {
            programId: transaction.instructions[0].programId.toString(),
            pubkeyInData: webAuthnPubKey.toString('hex'),
            dataSize: transaction.instructions[0].data.length
          });
          
          // Bắt đầu thêm xử lý lỗi SendTransactionError tốt hơn
          try {
            // Gửi transaction với opion skipPreflight: false để bắt lỗi sớm
            const signature = await connection.sendTransaction(transaction, [payerKeypair], {
              skipPreflight: false,
              preflightCommitment: 'confirmed',
              maxRetries: 3
            });
            
            // Thêm xử lý gói confirmTransaction vào try/catch riêng để bắt lỗi trong quá trình xác nhận
            try {
              await connection.confirmTransaction(signature, 'confirmed');
              
              // Tạo đối tượng proposal để lưu vào Firebase
              const proposalData = {
                proposalId: proposalId.toNumber(),
                multisigAddress: multisigPDAObj.toString(),
                description: description,
                action: 'transfer',
                status: 'pending',
                createdAt: Timestamp.now(),
                creator: payerKeypair.publicKey.toString(),
                signers: [], // Không tự động coi người tạo đã ký, để họ ký riêng như các guardian khác
                requiredSignatures: thresholdValue, // Sử dụng threshold đã kiểm tra
                amount: amountLamports.toNumber(),
                destination: destinationPubkey.toString(),
                tokenMint: null,
                transactionSignature: signature,
                proposalAddress: proposalPubkey.toString(), // Thêm trường proposalAddress
              };
              
              console.log("Lưu proposal vào Firebase:", proposalData);
              
              try {
                // Sử dụng service để lưu đề xuất
                console.log("Bắt đầu lưu proposal vào Firebase với dữ liệu:", proposalData);
                const docId = await createProposal(proposalData);
                console.log("Đã lưu proposal vào Firebase thành công, ID:", docId);
                
                // Tạo link ký đề xuất và lưu vào Firebase
                const baseUrl = window.location.origin;
                const signingLink = `${baseUrl}/#/sign-proposal/${proposalPubkey.toString()}`;
                
                // Cập nhật proposal với link ký
                await updateProposalWithSigningLink(proposalPubkey.toString(), signingLink);
                
                // Hiển thị link và QR code
                setProposalSigningLink(signingLink);
                setShowProposalQR(true);
                
                setStatus(`Đã tạo đề xuất thành công! Signature: ${signature}\nLink ký đề xuất: ${signingLink}`);
              } catch (firebaseError) {
                console.error("Lỗi chi tiết khi lưu proposal vào Firebase:", firebaseError);
                // Hiển thị thông tin lỗi cụ thể hơn
                if (firebaseError instanceof Error) {
                  console.error("Tên lỗi:", firebaseError.name);
                  console.error("Message:", firebaseError.message);
                  console.error("Stack:", firebaseError.stack);
                }
              }
              
              setShowProposalForm(false);
              
              // Tải lại danh sách đề xuất
              if (program && multisigInfo?.pubkey) {
                setTimeout(() => {
                  loadMultisigProposals(multisigInfo.pubkey, program);
                }, 2000);
              }
            } catch (confirmError) {
              console.error("Lỗi khi xác nhận giao dịch:", confirmError);
              
              // Kiểm tra xem lỗi có thuộc về loại SendTransactionError không
              if (confirmError instanceof Error) {
                const errorMessage = confirmError.message;
                // Lấy logs từ kết quả simulation nếu có
                let logs: string[] = [];
                
                // @ts-ignore - Truy cập thuộc tính logs nếu có
                if (confirmError.logs) {
                  // @ts-ignore
                  logs = confirmError.logs;
                }
                
                // In ra logs để debug
                console.error("Transaction logs:", logs);
                
                // Phân tích thông tin lỗi để hiển thị thông báo cụ thể
                let errorDetail = "Lỗi không xác định";
                
                if (errorMessage.includes("custom program error: 0x2")) {
                  errorDetail = "Lỗi tham số không hợp lệ (custom program error: 0x2). Có thể do:";
                  errorDetail += "\n- Sai địa chỉ đích";
                  errorDetail += "\n- Sai số lượng SOL";
                  errorDetail += "\n- Guardian không có quyền tạo đề xuất";
                } else if (errorMessage.includes("custom program error: 0x1")) {
                  errorDetail = "Lỗi khởi tạo sai (custom program error: 0x1)";
                } else if (errorMessage.includes("custom program error: 0x3")) {
                  errorDetail = "Lỗi đề xuất đã tồn tại (custom program error: 0x3)";
                } else {
                  errorDetail = `Lỗi: ${errorMessage}`;
                }
                
                setStatus(`Giao dịch thất bại: ${errorDetail}`);
              } else {
                setStatus(`Giao dịch thất bại với lỗi không xác định`);
              }
            }
          } catch (sendError: any) {
            // Xử lý lỗi khi gửi giao dịch
            console.error("Lỗi khi gửi giao dịch:", sendError);
            
            // Lấy logs từ kết quả simulation nếu có
            let logs: string[] = [];
            if (sendError.logs) {
              logs = sendError.logs;
              console.error("Logs đầy đủ từ blockchain:", logs);
            }
            
            // Lấy thông tin chi tiết từ transaction nếu có signature
            if (sendError.signature) {
              try {
                const txInfo = await connection.getTransaction(sendError.signature, {
                  commitment: 'confirmed',
                  maxSupportedTransactionVersion: 0
                });
                console.error("Chi tiết giao dịch:", txInfo?.meta?.logMessages);
                
                if (txInfo?.meta?.logMessages) {
                  logs = txInfo.meta.logMessages;
                }
              } catch (e) {
                console.error("Không thể lấy thông tin chi tiết giao dịch:", e);
              }
            }
            
            // In ra logs để debug
            console.error("Simulation logs:", logs);
            
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
            } else if (sendError.message.includes("Instruction #")) {
              errorDetail = `Lỗi instruction: ${sendError.message}`;
              
              // Thêm logs từ blockchain nếu có
              if (logs.length > 0) {
                errorDetail += "\n\nChi tiết từ blockchain:\n" + logs.join('\n');
              }
            } else {
              errorDetail = `Lỗi: ${sendError.message}`;
            }
            
            setStatus(`Giao dịch thất bại: ${errorDetail}`);
            
            // Hiển thị modal với thông tin lỗi chi tiết nếu logs dài
            if (logs.length > 5) {
              // Tạo modal hoặc hiển thị logs trong console để người dùng có thể xem
              console.error("=== CHI TIẾT LỖI ĐẦY ĐỦ TỪ BLOCKCHAIN ===");
              console.error(logs.join('\n'));
            }
          }
      } catch (error) {
        console.error("Lỗi khi xử lý WebAuthn assertion:", error);
        setStatus(prev => `${prev}\nLỗi khi xử lý WebAuthn assertion: ${error instanceof Error ? error.message : String(error)}`);
        }
      } catch (error) {
        console.error('Lỗi khi tạo đề xuất:', error);
        setStatus(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      console.error('Lỗi khi tạo đề xuất:', error);
      setStatus(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };
  
  
  // Hiển thị form transfer nếu đã đăng nhập thành công
  const toggleTransferForm = () => {
    setShowTransferForm(!showTransferForm);
  };

  // Hàm điều hướng đến trang danh sách đề xuất
  const goToProposalList = () => {
    navigate('/proposals');
  };

  // Khi tìm thấy multisig address thành công, lưu vào localStorage
  useEffect(() => {
    if (multisigAddress) {
      // Lưu địa chỉ ví vào localStorage để sử dụng ở các trang khác
      localStorage.setItem('multisigAddress', multisigAddress.toString());
      console.log("MultisigPanel: Đã lưu địa chỉ ví vào localStorage:", multisigAddress.toString());
    }
  }, [multisigAddress]);

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', margin: '20px', padding: '20px' }}>
      <h2>Ví đa chữ ký Moon Wallet</h2>
      
      {isLoading ? (
        <div>Đang tải thông tin ví đa chữ ký...</div>
      ) : multisigAddress ? (
        <div>
          <div style={styles.container}>
            <h3 style={styles.header}>Thông tin ví</h3>
            <p><strong>Địa chỉ ví:</strong> {multisigAddress.toString()}</p>
            {multisigInfo && (
              <div>
                <p><strong>Guardians:</strong> {multisigInfo.guardians?.length || 0}</p>
                <p><strong>Ngưỡng ký cần thiết:</strong> {multisigInfo.threshold !== undefined ? multisigInfo.threshold : 'Chưa xác định'}</p>
              </div>
            )}
            
            {/* Nút để chuyển đến trang danh sách đề xuất */}
            <button 
              style={styles.buttonSecondary}
              onClick={goToProposalList}
            >
              Xem danh sách đề xuất
            </button>
            
            {/* Nút để mở form tạo đề xuất chuyển tiền */}
            <button 
              style={styles.button}
              onClick={toggleTransferForm}
            >
              {showTransferForm ? 'Đóng form chuyển tiền' : 'Tạo đề xuất chuyển tiền'}
            </button>
          </div>
          
          {/* Hiển thị QR code và link ký đề xuất */}
          {showProposalQR && proposalSigningLink && (
            <div style={styles.container}>
              <h3 style={styles.header}>Chia sẻ link ký đề xuất</h3>
              <p>Các guardian có thể quét mã QR hoặc sử dụng link dưới đây để ký đề xuất:</p>
              
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '20px 0' }}>
                <QRCode value={proposalSigningLink} size={200} />
                
                <div style={{ width: '100%', marginTop: '20px' }}>
                  <input 
                    type="text" 
                    value={proposalSigningLink} 
                    readOnly 
                    style={{ ...styles.input, width: 'calc(100% - 120px)' }}
                  />
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(proposalSigningLink);
                      alert("Đã sao chép link!");
                    }}
                    style={{...styles.buttonSecondary, marginLeft: '10px', padding: '8px 15px'}}
                  >
                    Sao chép
                  </button>
                </div>
                
                <p style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
                  Guardians có thể truy cập link này để ký đề xuất mà không cần đăng nhập vào ứng dụng.
                </p>
              </div>
              
              <button 
                onClick={() => setShowProposalQR(false)}
                style={{...styles.buttonSecondary, backgroundColor: '#999'}}
              >
                Đóng
              </button>
            </div>
          )}
          
          {/* Form tạo đề xuất chuyển tiền */}
          {showTransferForm && (
            <div style={styles.container}>
              <h3 style={styles.header}>Tạo đề xuất chuyển tiền</h3>
              
              <div style={styles.inputGroup}>
                <label style={styles.label}>Mô tả đề xuất:</label>
                <input 
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)} 
                  placeholder="Mô tả mục đích chuyển tiền"
                  disabled={isLoading}
                  style={styles.input}
                />
              </div>
              
              <div style={styles.inputGroup}>
                <label style={styles.label}>Địa chỉ nhận:</label>
                <input 
                  type="text"
                  value={destinationAddress}
                  onChange={(e) => setDestinationAddress(e.target.value)} 
                  placeholder="Địa chỉ ví Solana nhận tiền"
                  disabled={isLoading}
                  style={styles.input}
                />
              </div>
              
              <div style={styles.inputGroup}>
                <label style={styles.label}>Số lượng SOL:</label>
                <input 
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)} 
                  placeholder="Nhập số lượng SOL"
                  disabled={isLoading}
                  step="0.001"
                  min="0"
                  style={styles.input}
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
        </div>
      ) : (
        <div>Không tìm thấy thông tin ví đa chữ ký.</div>
      )}
    </div>
  );
};
