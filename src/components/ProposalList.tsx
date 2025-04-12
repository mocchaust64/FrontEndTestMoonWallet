import React, { useState, useEffect } from 'react';
import { PublicKey, Transaction, Connection, TransactionInstruction, SystemProgram, Keypair } from '@solana/web3.js';
import { Box, Button, Card, CardContent, Chip, Container, Typography, CircularProgress, Divider, Stack, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Alert } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import HomeIcon from '@mui/icons-material/Home';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import { useNavigate } from 'react-router-dom';
import { getProposalStatus, formatLamportsToSOL, formatTimestamp } from '../utils/uiHelpers';
import { Box as MuiBox } from '@mui/material';
import { getProposalsByWallet, Proposal, addSignerToProposal, updateProposalStatus } from '../firebase/proposalService';
import { getWebAuthnAssertion, createWebAuthnVerificationData } from '../utils/webauthnUtils';
import { derToRaw, createSecp256r1Instruction, createApproveProposalTx, SYSVAR_INSTRUCTIONS_PUBKEY, SYSVAR_CLOCK_PUBKEY } from '../utils/transactionUtils';
import { getWalletByCredentialId, normalizeCredentialId } from '../firebase/webAuthnService';
import { getMultisigPDA, getGuardianPDA } from '../utils/credentialUtils';
import { getEnvKeypair } from '../utils/multisig/multisigUtils';
import { Buffer } from 'buffer';
import BN from 'bn.js';
import { PROGRAM_ID } from '../utils/constants';
import { PlayArrowOutlined } from '@mui/icons-material';
import { Proposal as FirebaseProposal } from '../firebase/proposalService';
import { sha256 } from "@noble/hashes/sha256";

// Thêm hằng số cho chuẩn hóa signature
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
  
  // Kiểm tra nếu s > half_order
  if (sBN.gt(SECP256R1_HALF_ORDER)) {
    console.log("Chuẩn hóa signature về dạng Low-S");
    // Tính s' = order - s
    const sNormalized = SECP256R1_ORDER.sub(sBN);
    const sNormalizedBuffer = sNormalized.toArrayLike(Buffer, 'be', 32);
    return Buffer.concat([r, sNormalizedBuffer]);
  }
  
  console.log("Signature đã ở dạng Low-S");
  return sig;
};

// Thêm hàm hỗ trợ tạo link tới Solana Explorer
const getSolanaExplorerLink = (signature: string) => {
  const explorerBaseUrl = process.env.REACT_APP_NETWORK === 'mainnet' 
    ? 'https://explorer.solana.com/tx/' 
    : 'https://explorer.solana.com/tx/?cluster=devnet';
  
  return `${explorerBaseUrl}/${signature}`;
};

// Kiểm tra log thành công từ blockchain
const getTxDetailsFromBlockchain = async (connection: Connection, signature: string) => {
  try {
    console.log(`Đang lấy thông tin chi tiết cho giao dịch: ${signature}`);
    
    const txInfo = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });
    
    if (!txInfo) {
      console.warn(`Không tìm thấy thông tin giao dịch cho signature: ${signature}`);
      return null;
    }
    
    console.log("Logs từ blockchain:", txInfo.meta?.logMessages);
    
    // Kiểm tra lỗi trong giao dịch
    if (txInfo.meta?.err) {
      console.error("Giao dịch có lỗi:", txInfo.meta.err);
      return {
        success: false,
        logs: txInfo.meta.logMessages || [],
        error: JSON.stringify(txInfo.meta.err)
      };
    }
    
    return {
      success: true,
      logs: txInfo.meta?.logMessages || [],
      fee: txInfo.meta?.fee || 0
    };
  } catch (error) {
    console.error("Lỗi khi lấy thông tin giao dịch:", error);
    return null;
  }
};

// Extend interface Proposal để thêm trường proposalPubkey
interface ExtendedProposal extends FirebaseProposal {
  proposalPubkey?: string;
}

const ProposalList: React.FC = () => {
  const [proposals, setProposals] = useState<ExtendedProposal[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [noWalletFound, setNoWalletFound] = useState<boolean>(false);
  const navigate = useNavigate();

  const [walletAddress, setWalletAddress] = useState<PublicKey | null>(null);
  
  // Trạng thái cho việc ký đề xuất
  const [signingLoading, setSigningLoading] = useState<boolean>(false);
  const [currentSigningProposal, setCurrentSigningProposal] = useState<ExtendedProposal | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signSuccess, setSignSuccess] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [projectFeePayerKeypair, setProjectFeePayerKeypair] = useState<Keypair | null>(null);

  // Khi component được mount, tìm multisigAddress từ localStorage và khởi tạo connection
  useEffect(() => {
    // Khởi tạo connection
    const endpoint = process.env.REACT_APP_RPC_ENDPOINT || 'http://127.0.0.1:8899';
    const newConnection = new Connection(endpoint, { commitment: 'confirmed' });
    setConnection(newConnection);
    
    // Lấy keypair của project từ biến môi trường
    const initProjectKeypair = async () => {
      try {
        const keypair = await getEnvKeypair();
        setProjectFeePayerKeypair(keypair);
        console.log("Đã lấy project fee payer keypair:", keypair.publicKey.toString());
      } catch (error) {
        console.error("Lỗi khi lấy project fee payer keypair:", error);
      }
    };
    
    initProjectKeypair();
    
    const savedWalletAddress = localStorage.getItem('multisigAddress');
    if (savedWalletAddress) {
      try {
        // Tạo đối tượng PublicKey từ chuỗi đã lưu
        const walletPubkey = new PublicKey(savedWalletAddress);
        console.log("Đã lấy địa chỉ ví từ localStorage:", walletPubkey.toString());
        
        // Lưu vào state để sử dụng sau này
        setWalletAddress(walletPubkey);
        
        // Tải danh sách đề xuất với địa chỉ này
        fetchProposals(walletPubkey);
      } catch (error) {
        console.error("Lỗi khi khôi phục địa chỉ ví từ localStorage:", error);
        setNoWalletFound(true);
        setLoading(false);
      }
    } else {
      console.log("Không tìm thấy địa chỉ ví trong localStorage");
      setNoWalletFound(true);
      setLoading(false);
    }
  }, []);

  const fetchProposals = async (walletAddress: PublicKey) => {
    try {
      setLoading(true);
      // Sử dụng service để lấy dữ liệu
      const fetchedProposals = await getProposalsByWallet(walletAddress);
      // Chuyển đổi từ Proposal[] sang ExtendedProposal[]
      setProposals(fetchedProposals as unknown as ExtendedProposal[]);
    } catch (error) {
      console.error("Lỗi khi tải đề xuất:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewProposal = (proposalId: number) => {
    navigate(`/proposal/${proposalId}`);
  };

  const goToHome = () => {
    navigate('/');
  };

  // Kiểm tra người dùng hiện tại đã ký đề xuất chưa
  const hasCurrentUserSigned = (proposal: ExtendedProposal) => {
    // Lấy guardian public key từ localStorage hoặc WebAuthn
    const userCredentials = JSON.parse(localStorage.getItem("userCredentials") || "[]");
    if (!userCredentials.length || !proposal.signers) return false;
    
    // Lấy guardianPublicKey từ cache nếu có
    const cachedGuardianPublicKey = localStorage.getItem("guardianPublicKey");
    
    if (cachedGuardianPublicKey) {
      return proposal.signers.includes(cachedGuardianPublicKey);
    }
    
    // Nếu không có cached public key, trả về false vì chúng ta không thể 
    // lấy public key mà không có tương tác người dùng (WebAuthn)
    return false;
  };

  // Mở hộp thoại xác nhận ký đề xuất
  const openSignConfirmDialog = (proposal: ExtendedProposal) => {
    setCurrentSigningProposal(proposal);
    setConfirmOpen(true);
    setSignError(null);
    setSignSuccess(null);
  };

  // Kiểm tra xem đề xuất đã đủ chữ ký chưa
  const hasEnoughSignatures = (proposal: ExtendedProposal): boolean => {
    return proposal.signers && proposal.signers.length >= proposal.requiredSignatures;
  };

  // Hàm thực thi đề xuất
  const handleExecuteProposal = async (proposalId: number) => {
    if (!walletAddress || !connection || !projectFeePayerKeypair) {
      setSignError("Không thể thực thi đề xuất: Thiếu thông tin cần thiết.");
      return;
    }

    setSigningLoading(true);
    setSignError(null);
    setSignSuccess(null);
    setConfirmOpen(false);

    try {
      console.log("=== BẮT ĐẦU THỰC THI ĐỀ XUẤT ===");
      console.log("ProposalId:", proposalId);
      console.log("MultisigPDA:", walletAddress.toString());
      
      // Tìm proposal từ danh sách
      const proposal = proposals.find(p => p.proposalId === proposalId);
      if (!proposal) {
        throw new Error(`Không tìm thấy proposal với ID ${proposalId}. Danh sách proposals: ${JSON.stringify(proposals.map(p => p.proposalId))}`);
      }
      
      console.log("Đã tìm thấy proposal:", proposal.description);
      
      // Khai báo biến ở phạm vi lớn hơn để sử dụng sau này
      let calculatedProposalPubkey: PublicKey;
      
      try {
        // Tính toán proposalPDA từ multisigPDA và proposalId thay vì sử dụng tham số truyền vào
        const seedBuffer = Buffer.from("proposal");
        const multisigBuffer = walletAddress.toBuffer();
        const proposalIdBuffer = new BN(proposalId).toArrayLike(Buffer, "le", 8);
        
        console.log("Seeds cho PDA:", {
          seed1: seedBuffer.toString('hex'),
          seed2: multisigBuffer.toString('hex'),
          seed3: proposalIdBuffer.toString('hex'),
          programId: PROGRAM_ID.toString()
        });
        
        const [pubkey] = await PublicKey.findProgramAddress(
          [seedBuffer, multisigBuffer, proposalIdBuffer],
          PROGRAM_ID
        );
        
        calculatedProposalPubkey = pubkey;
        console.log("Đã tính toán Proposal PDA:", calculatedProposalPubkey.toString());
        
        // Lưu vào proposal để sử dụng sau này
        proposal.proposalPubkey = calculatedProposalPubkey.toString();
      } catch (pdaError) {
        console.error("Lỗi khi tính toán Proposal PDA:", pdaError);
        throw new Error(`Không thể tính toán Proposal PDA: ${pdaError instanceof Error ? pdaError.message : String(pdaError)}`);
      }
      
      // Hiển thị thông báo
      setSignSuccess('Đang hiển thị danh sách khóa WebAuthn, vui lòng chọn khóa để xác thực...');
      
      // Lấy timestamp hiện tại (giây)
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Tạo challenge để yêu cầu người dùng chọn khóa WebAuthn
      const initialChallenge = new Uint8Array(32);
      window.crypto.getRandomValues(initialChallenge);
      
      // Yêu cầu người dùng chọn khóa WebAuthn 
      console.log("Yêu cầu người dùng chọn khóa WebAuthn để xác thực trước khi thực thi đề xuất");
      
      let credential;
      try {
        credential = await navigator.credentials.get({
          publicKey: {
            challenge: initialChallenge,
            timeout: 60000,
            userVerification: 'required',
            rpId: window.location.hostname,
          }
        }) as PublicKeyCredential;
        
        console.log("WebAuthn credential đã được chọn thành công", credential.id);
      } catch (webAuthnError) {
        console.error("Lỗi khi yêu cầu WebAuthn:", webAuthnError);
        throw new Error(`Lỗi xác thực WebAuthn: ${webAuthnError instanceof Error ? webAuthnError.message : String(webAuthnError)}`);
      }
      
      // Lấy credential ID từ xác thực
      const credentialIdString = Buffer.from(credential.rawId).toString('base64');
      console.log("Người dùng đã chọn credential ID:", credentialIdString);
      
      // Lưu credential ID vào localStorage
      const userCredentials = JSON.parse(localStorage.getItem("userCredentials") || "[]");
      if (userCredentials.length === 0) {
        userCredentials.push({ id: credentialIdString });
        localStorage.setItem("userCredentials", JSON.stringify(userCredentials));
        console.log("Đã lưu credential ID vào localStorage");
      }
      
      // Chuẩn hóa credential ID để truy vấn Firebase
      const normalizedCredentialId = normalizeCredentialId(credentialIdString);
      console.log("Normalized Credential ID:", normalizedCredentialId);
      
      // Lấy public key từ Firebase
      let webAuthnWallet;
      try {
        webAuthnWallet = await getWalletByCredentialId(normalizedCredentialId);
        if (!webAuthnWallet || !webAuthnWallet.guardianPublicKey) {
          throw new Error("Không tìm thấy thông tin guardian hoặc public key");
        }
        console.log("Đã lấy thông tin guardian từ Firebase:", { 
          guardianId: webAuthnWallet.guardianId,
          publicKeyLength: webAuthnWallet.guardianPublicKey.length
        });
      } catch (walletError) {
        console.error("Lỗi khi lấy thông tin ví từ Firebase:", walletError);
        throw new Error(`Không thể lấy thông tin ví: ${walletError instanceof Error ? walletError.message : String(walletError)}`);
      }
      
      // Lấy WebAuthn public key - xử lý giống như trong TransferForm
      let webAuthnPubKey: Buffer;
      
      // Luôn lấy key từ Firebase như khi tạo đề xuất - không dùng localStorage
      if (webAuthnWallet.guardianPublicKey) {
        // Sử dụng WebAuthn public key từ Firebase
        console.log('Sử dụng WebAuthn public key từ Firebase để đảm bảo khớp với key lúc tạo đề xuất');
        webAuthnPubKey = Buffer.from(new Uint8Array(webAuthnWallet.guardianPublicKey));
        
        // Lưu vào localStorage THEO CREDENTIAL ID để các hàm trong transactionUtils có thể sử dụng
        const credentialSpecificKey = `guardianPublicKey_${normalizedCredentialId}`;
        const guardianPublicKey = Buffer.from(new Uint8Array(webAuthnWallet.guardianPublicKey)).toString('hex');
        console.log("Lưu guardianPublicKey vào localStorage theo credential ID:", guardianPublicKey.slice(0, 10) + "...");
        localStorage.setItem(credentialSpecificKey, guardianPublicKey);
      } else {
        throw new Error("Không tìm thấy WebAuthn public key trong Firebase");
      }
      
      console.log('==== DEBUG WEBAUTHN PUBLIC KEY ====');
      console.log('WebAuthn Public Key (Hex):', webAuthnPubKey.toString('hex'));
      console.log('WebAuthn Public Key Type:', webAuthnPubKey.constructor.name);
      console.log('WebAuthn Public Key Length:', webAuthnPubKey.length);
      console.log('WebAuthn Public Key bytes:', Array.from(webAuthnPubKey));
      console.log('=================================');
      
      // Log thông tin chi tiết về việc gọi hàm hash
      console.log('===== DEBUG HASH CALCULATION =====');
      console.log('Hash Function Input (exact param):', Buffer.from(webAuthnPubKey).toString('hex'));
      console.log('Hash Function Input Type:', Buffer.from(webAuthnPubKey).constructor.name);
      console.log('Hash Function Input Bytes:', Array.from(Buffer.from(webAuthnPubKey)));
      
      // Tính hash sử dụng sha256 giống contract
      const hashBytes = sha256(Buffer.from(webAuthnPubKey));
      const fullHashHex = Buffer.from(hashBytes).toString('hex');
      console.log('Full SHA-256 Hash (Hex):', fullHashHex);
      
      // Lấy 6 bytes đầu tiên của hash
      const hashBytesStart = hashBytes.slice(0, 6);
      
      // Chuyển đổi sang hex string giống hàm to_hex trong contract
      const pubkeyHashHex = Array.from(hashBytesStart)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      console.log('First 6 bytes of Hash (12 hex chars):', pubkeyHashHex);
      
      // Thêm debug để kiểm tra từng byte hash
      console.log('Hash bytes (first 6):', Array.from(hashBytesStart));
      console.log('Hash hex format with contract matching:');
      Array.from(hashBytesStart).forEach((byte, i) => {
        const hex = byte.toString(16).padStart(2, '0');
        console.log(`Byte ${i}: ${byte} -> hex: ${hex}`);
      });
      console.log('==============================================');
      
      // Tạo message với đầy đủ thông tin bao gồm pubkey hash
      const messageString = `execute:proposal_${proposalId},timestamp:${timestamp},pubkey:${pubkeyHashHex}`;
      console.log("Message đầy đủ để ký:", messageString);
      
      // Xử lý response từ WebAuthn
      const response = credential.response as AuthenticatorAssertionResponse;
      
      // Chuyển đổi chữ ký DER sang raw
      let signatureRaw;
      try {
        signatureRaw = derToRaw(new Uint8Array(response.signature));
        const signatureBuffer = Buffer.from(signatureRaw);
        console.log("Đã chuyển đổi chữ ký DER sang raw format thành công, độ dài:", signatureBuffer.length);
      } catch (sigError) {
        console.error("Lỗi khi chuyển đổi chữ ký:", sigError);
        throw new Error(`Không thể chuyển đổi chữ ký: ${sigError instanceof Error ? sigError.message : String(sigError)}`);
      }
      
      // Chuẩn hóa signature về dạng Low-S nếu cần
      const normalizedSignature = normalizeSignatureToLowS(Buffer.from(signatureRaw));
      
      // Tạo verification data với xử lý đúng như TransferForm
      let verificationData;
      try {
        // 1. Tính hash của clientDataJSON
        const clientDataHash = await crypto.subtle.digest('SHA-256', response.clientDataJSON);
        const clientDataHashBytes = new Uint8Array(clientDataHash);
        
        // 2. Tạo verification data đúng cách: authenticatorData + hash(clientDataJSON)
        const authDataBytes = new Uint8Array(response.authenticatorData);
        verificationData = new Uint8Array(authDataBytes.length + clientDataHashBytes.length);
        verificationData.set(authDataBytes, 0);
        verificationData.set(clientDataHashBytes, authDataBytes.length);
        
        console.log("Đã tạo verification data thành công, độ dài:", verificationData.length);
      } catch (verificationError) {
        console.error("Lỗi khi tạo verification data:", verificationError);
        throw new Error(`Không thể tạo verification data: ${verificationError instanceof Error ? verificationError.message : String(verificationError)}`);
      }
      
      // Tạo secp256r1 instruction
      let secp256r1Instruction;
      try {
        const publicKeyBuffer = Buffer.from(webAuthnPubKey);
        
        secp256r1Instruction = createSecp256r1Instruction(
          Buffer.from(verificationData),
          publicKeyBuffer,
          normalizedSignature,
          false
        );
        console.log("Đã tạo secp256r1 instruction thành công");
      } catch (instructionError) {
        console.error("Lỗi khi tạo secp256r1 instruction:", instructionError);
        throw new Error(`Không thể tạo secp256r1 instruction: ${instructionError instanceof Error ? instructionError.message : String(instructionError)}`);
      }
      
      // 3. Tạo instruction thực thi đề xuất
      // Discriminator chính xác từ IDL cho hàm execute_proposal 
      // Giá trị cũ: [186, 60, 116, 133, 108, 128, 111, 28]
      // Giá trị đúng từ IDL trong file moon_wallet_program.ts
      const executeProposalDiscriminator = Buffer.from([186, 60, 116, 133, 108, 128, 111, 28]);
      
      // Log để kiểm tra discriminator
      console.log('Execute Proposal Discriminator (hex):', Buffer.from(executeProposalDiscriminator).toString('hex'));
      
      // Tạo dữ liệu cho tham số proposal_id
      const proposalIdBuffer = Buffer.alloc(8);
      proposalIdBuffer.writeBigUInt64LE(BigInt(proposalId), 0);
      
      // Tạo data instruction với proposal_id
      const executeData = Buffer.concat([
        executeProposalDiscriminator,
        proposalIdBuffer
      ]);
      
      // Tạo transaction
      const transaction = new Transaction();
      
      try {
        // Thêm secp256r1 instruction
        transaction.add(secp256r1Instruction);
        
        // Tạo instruction thực thi đề xuất
        const executeInstruction = new TransactionInstruction({
          keys: [
            { pubkey: new PublicKey(proposal.multisigAddress), isSigner: false, isWritable: true }, // multisig
            { pubkey: calculatedProposalPubkey, isSigner: false, isWritable: true }, // proposal
            { pubkey: projectFeePayerKeypair.publicKey, isSigner: true, isWritable: true }, // payer
            { pubkey: proposal.destination ? new PublicKey(proposal.destination) : SystemProgram.programId, isSigner: false, isWritable: true }, // destination
            { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false }, // clock
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
          ],
          programId: PROGRAM_ID,
          data: executeData,
        });
        
        // Log thông tin các accounts trong instruction
        console.log("Accounts trong execute instruction:", {
          multisig: proposal.multisigAddress,
          proposal: calculatedProposalPubkey.toString(),
          payer: projectFeePayerKeypair.publicKey.toString(),
          destination: proposal.destination || SystemProgram.programId.toString(),
          clock: SYSVAR_CLOCK_PUBKEY.toString(),
          systemProgram: SystemProgram.programId.toString()
        });
        
        // Thêm instruction thực thi đề xuất
        transaction.add(executeInstruction);
        
        // Thiết lập fee payer và blockhash
        transaction.feePayer = projectFeePayerKeypair.publicKey;
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        
        // Ký transaction với project fee payer keypair
        transaction.sign(projectFeePayerKeypair);
        
        // Log thông tin transaction
        console.log("Transaction đã được tạo:", {
          numInstructions: transaction.instructions.length,
          feePayer: transaction.feePayer.toString(),
          recentBlockhash: transaction.recentBlockhash
        });
        
        // Gửi transaction
        console.log("Đang gửi transaction...");
        const signature = await connection.sendRawTransaction(transaction.serialize());
        console.log("Transaction đã được gửi với signature:", signature);
        
        // Xác nhận giao dịch
        console.log("Đang chờ xác nhận giao dịch...");
        const confirmation = await connection.confirmTransaction(signature, 'confirmed');
        console.log("Transaction đã được xác nhận:", confirmation);
        
        // Cập nhật trạng thái đề xuất trong Firebase
        console.log("Cập nhật trạng thái đề xuất trong Firebase...");
        await updateProposalStatus(
          proposal.multisigAddress,
          proposal.proposalId,
          'executed',
          signature
        );
        
        setSignSuccess(`Đã thực thi đề xuất thành công! Signature: ${signature}`);
        setSigningLoading(false);
        
        // Refresh danh sách proposal
        fetchProposals(walletAddress);
        console.log("=== KẾT THÚC THỰC THI ĐỀ XUẤT ===");
      } catch (txError) {
        console.error("Lỗi trong quá trình xử lý transaction:", txError);
        
        // Kiểm tra xem có phải lỗi từ RPC không
        const errorMessage = txError instanceof Error ? txError.message : String(txError);
        if (errorMessage.includes("failed to send transaction")) {
          throw new Error(`Không thể gửi transaction: ${errorMessage}`);
        }
        
        // Mặc định throw lỗi gốc
        throw txError;
      }
    } catch (error) {
      console.error('Lỗi khi thực thi đề xuất:', error);
      
      // Phân tích chi tiết lỗi
      let errorMessage = 'Lỗi không xác định';
      
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // Kiểm tra lỗi từ blockchain
        if (error.message.includes('custom program error')) {
          // Trích xuất mã lỗi nếu có
          const errorCodeMatch = error.message.match(/custom program error: (0x[0-9a-fA-F]+)/);
          if (errorCodeMatch && errorCodeMatch[1]) {
            const errorCode = errorCodeMatch[1];
            
            // Ánh xạ mã lỗi tới thông báo dễ hiểu
            switch (errorCode) {
              case '0x1':
                errorMessage = 'Khởi tạo không hợp lệ';
                break;
              case '0x7':
                errorMessage = 'Không đủ chữ ký để thực thi đề xuất';
                break;
              case '0x2':
                errorMessage = 'Tham số không hợp lệ';
                break;
              case '0x1770': // 0x1770 = 6000
                errorMessage = 'Lỗi chương trình: Chủ sở hữu không hợp lệ';
                break;
              case '0x1771': // 0x1771 = 6001
                errorMessage = 'Lỗi chương trình: Thao tác không hợp lệ';
                break;
              default:
                errorMessage = `Lỗi chương trình: ${errorCode}`;
            }
          }
        }
      }
      
      setSignError(errorMessage);
      setSigningLoading(false);
    }
  };

  // Thêm lại hàm handleSignProposal đã bị xóa
  const handleSignProposal = async () => {
    if (!currentSigningProposal || !walletAddress || !connection || !projectFeePayerKeypair) {
      setSignError("Không thể ký đề xuất: Thiếu thông tin cần thiết.");
      return;
    }
    
    setSigningLoading(true);
    setSignError(null);
    setSignSuccess(null);
    setConfirmOpen(false);
    
    try {
      // Tạo thông điệp để ký
      const timestamp = Math.floor(Date.now() / 1000);
      const proposalId = currentSigningProposal.proposalId;
      
      console.log("Đang chuẩn bị thông tin để ký đề xuất ID:", proposalId);
      
      // Step 1: Yêu cầu người dùng chọn khóa WebAuthn
      const initialChallenge = new Uint8Array(32);
      window.crypto.getRandomValues(initialChallenge);
      
      setSignSuccess('Đang hiển thị danh sách khóa WebAuthn, vui lòng chọn khóa để xác thực...');
      
      // Yêu cầu người dùng chọn khóa WebAuthn
      console.log("Yêu cầu người dùng chọn khóa WebAuthn để xác thực");
      let credential;
      try {
        credential = await navigator.credentials.get({
        publicKey: {
          challenge: initialChallenge,
          timeout: 60000,
          userVerification: 'required',
            rpId: window.location.hostname,
        }
      }) as PublicKeyCredential;
      } catch (error) {
        console.error("Lỗi khi yêu cầu WebAuthn:", error);
        throw new Error("Người dùng đã hủy xác thực hoặc xác thực thất bại");
      }
      
      // Lấy credential ID từ xác thực
      const credentialIdString = Buffer.from(credential.rawId).toString('base64');
      console.log("Người dùng đã chọn credential ID:", credentialIdString);
      
      // Step 2: Chuẩn hóa credential ID
      const normalizedCredentialId = normalizeCredentialId(credentialIdString);
      console.log('Normalized Credential ID được sử dụng:', normalizedCredentialId);
      
      // Step 3: Lấy thông tin guardian từ Firebase
      const credentialMapping = await getWalletByCredentialId(normalizedCredentialId);
      
      if (!credentialMapping || !credentialMapping.guardianId) {
        throw new Error('Không tìm thấy thông tin guardian cho credential này trong Firebase');
      }
      
      // Lấy guardianId từ credential mapping
      const guardianId = credentialMapping.guardianId;
      console.log("Đã tìm thấy guardian ID:", guardianId);
    
      // Step 4: Tính hash của WebAuthn public key nếu có
      let webAuthnPubKey: Buffer;
      
      // Luôn lấy key từ Firebase như khi tạo đề xuất - không dùng localStorage
      if (credentialMapping.guardianPublicKey) {
        // Sử dụng WebAuthn public key từ Firebase
        console.log('Sử dụng WebAuthn public key từ Firebase để đảm bảo khớp với key lúc tạo đề xuất');
        webAuthnPubKey = Buffer.from(new Uint8Array(credentialMapping.guardianPublicKey));
        
        // Lưu vào localStorage THEO CREDENTIAL ID để các hàm trong transactionUtils có thể sử dụng
        const credentialSpecificKey = `guardianPublicKey_${normalizedCredentialId}`;
        const guardianPublicKey = Buffer.from(new Uint8Array(credentialMapping.guardianPublicKey)).toString('hex');
        console.log("Lưu guardianPublicKey vào localStorage theo credential ID:", guardianPublicKey.slice(0, 10) + "...");
        localStorage.setItem(credentialSpecificKey, guardianPublicKey);
      } else {
        throw new Error("Không tìm thấy WebAuthn public key trong Firebase");
      }
      
      console.log('==== DEBUG WEBAUTHN PUBLIC KEY ====');
      console.log('WebAuthn Public Key (Hex):', webAuthnPubKey.toString('hex'));
      console.log('WebAuthn Public Key Type:', webAuthnPubKey.constructor.name);
      console.log('WebAuthn Public Key Length:', webAuthnPubKey.length);
      console.log('WebAuthn Public Key bytes:', Array.from(webAuthnPubKey));
      console.log('=================================');
      
      // Log thông tin chi tiết về việc gọi hàm hash trong ProposalList
      console.log('===== DEBUG PROPOSAL FORM HASH CALCULATION =====');
      // Log input chính xác cho hàm hash - quan trọng để so sánh với TransferForm
      console.log('Hash Function Input (exact param):', Buffer.from(webAuthnPubKey).toString('hex'));
      console.log('Hash Function Input Type:', Buffer.from(webAuthnPubKey).constructor.name);
      console.log('Hash Function Input Bytes:', Array.from(Buffer.from(webAuthnPubKey)));

      // Tính hash sử dụng sha256 giống contract - sử dụng trực tiếp thư viện
      const hashBytes = sha256(Buffer.from(webAuthnPubKey));
      const fullHashHex = Buffer.from(hashBytes).toString('hex');
      console.log('Full SHA-256 Hash (Hex):', fullHashHex);
      
      // Lấy 6 bytes đầu tiên của hash
      const hashBytesStart = hashBytes.slice(0, 6);
      
      // Chuyển đổi sang hex string giống hàm to_hex trong contract
      const pubkeyHashHex = Array.from(hashBytesStart)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      console.log('PROPOSAL: First 6 bytes of Hash (12 hex chars):', pubkeyHashHex);
      
      // Thêm debug để kiểm tra từng byte hash
      console.log('Hash bytes (first 6):', Array.from(hashBytesStart));
      console.log('Hash hex format with contract matching:');
      Array.from(hashBytesStart).forEach((byte, i) => {
        const hex = byte.toString(16).padStart(2, '0');
        console.log(`Byte ${i}: ${byte} -> hex: ${hex}`);
      });
      console.log('==============================================');
      
      // ĐOẠN CODE ĐỂ TEST - Tạm thời sử dụng hash cố định 
      // nếu không muốn dùng, comment đoạn này lại và bỏ comment dòng dưới
      // const hardcodedPublicKeyHash = "e64928648dcc";
      // console.log('Sử dụng hash cố định từ blockchain:', hardcodedPublicKeyHash);
      // console.log('Thay vì hash tính được:', pubkeyHashHex);
      
      // Step 5: Tạo thông điệp đầy đủ để ký
      const messageWithPubkey = `approve:proposal_${proposalId},guardian_${guardianId},timestamp:${timestamp},pubkey:${pubkeyHashHex}`;
      // const messageWithPubkey = `approve:proposal_${proposalId},guardian_${guardianId},timestamp:${timestamp},pubkey:${hardcodedPublicKeyHash}`;
      console.log("Thông điệp đầy đủ để ký:", messageWithPubkey);
      
      // Lấy response từ credential
      const response = credential.response as AuthenticatorAssertionResponse;
      
      // Chuẩn bị dữ liệu để ký
      const signature = new Uint8Array(response.signature);
      const authenticatorData = new Uint8Array(response.authenticatorData);
      const clientDataJSON = new Uint8Array(response.clientDataJSON);
      
      console.log('Đã ký thành công bằng WebAuthn');
      
      setSignSuccess('Đã ký đề xuất thành công, đang chuẩn bị gửi giao dịch lên blockchain...');
      
      // Step 6: Tiếp tục quy trình gửi transaction lên blockchain
      // Tính PDA cho multisig và guardian
      const multisigPDA = new PublicKey(walletAddress);
      const guardianPDA = await getGuardianPDA(multisigPDA, guardianId);
      
      // Tạo proposalPDA từ multisigPDA và proposalId
      const [proposalPubkey] = await PublicKey.findProgramAddress(
        [
          Buffer.from("proposal"),
          multisigPDA.toBuffer(),
          new BN(proposalId).toArrayLike(Buffer, "le", 8)
        ],
        PROGRAM_ID
      );
      
      console.log("Tạo giao dịch với thông tin:");
      console.log("- MultisigPDA:", multisigPDA.toString());
      console.log("- GuardianPDA:", guardianPDA.toString());
      console.log("- ProposalPDA:", proposalPubkey.toString());
      console.log("- GuardianID:", guardianId);
      console.log("- Timestamp:", timestamp);
      
      // Sử dụng hàm createApproveProposalTx
      const tx = await createApproveProposalTx(
        proposalPubkey,
        multisigPDA,
        guardianPDA,
        guardianId,
        projectFeePayerKeypair.publicKey,
        new Uint8Array(response.signature),
        new Uint8Array(response.authenticatorData),
        new Uint8Array(response.clientDataJSON),
        proposalId,
        timestamp,
        credentialIdString
      );
      
      // Thiết lập recent blockhash và fee payer
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = projectFeePayerKeypair.publicKey;
      
      // Ký transaction với project fee payer keypair
      tx.partialSign(projectFeePayerKeypair);
      
      // Gửi transaction lên blockchain
      setSignSuccess('Đang gửi giao dịch ký đề xuất lên blockchain...');
      
      const txSignature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
      
      console.log("Giao dịch ký đề xuất đã được gửi:", txSignature);
      
      // Xử lý kết quả giao dịch
      try {
        await connection.confirmTransaction(txSignature, 'confirmed');
        console.log("Giao dịch ký đề xuất đã được xác nhận trên blockchain");
        
        // Lấy thông tin chi tiết của giao dịch
        const txDetails = await getTxDetailsFromBlockchain(connection, txSignature);
        
        if (txDetails) {
          if (txDetails.success) {
            const explorerLink = getSolanaExplorerLink(txSignature);
            setSignSuccess(`Ký đề xuất thành công! ID giao dịch: ${txSignature}. 
              Xem trên Solana Explorer: ${explorerLink}`);
              
            // Cập nhật Firebase khi giao dịch thành công
            await addSignerToProposal(
              walletAddress.toString(),
              currentSigningProposal.proposalId,
              webAuthnPubKey.toString('hex') // Sử dụng webAuthnPubKey làm signerPublicKey
            );
            
            // Cập nhật UI và tải lại danh sách đề xuất
            setSignSuccess('Ký đề xuất thành công! Đã thêm chữ ký của bạn vào đề xuất và gửi lên blockchain.');
            fetchProposals(walletAddress);
          } else {
            // Xử lý các lỗi phổ biến
            let errorMessage = `Giao dịch được xác nhận nhưng có lỗi: ${txDetails.error}`;
            
            if (txDetails.logs) {
              const logs = txDetails.logs.join(' ');
              console.error("Blockchain logs:", logs);
              
              if (logs.includes("expected this account to be already initialized")) {
                errorMessage = "Tài khoản multisig chưa được khởi tạo trên blockchain. Hãy tạo multisig trước khi ký đề xuất.";
              } else if (logs.includes("has already signed this proposal")) {
                errorMessage = "Bạn đã ký đề xuất này trước đó.";
              } else if (logs.includes("proposal not found")) {
                errorMessage = "Không tìm thấy đề xuất này trên blockchain.";
              }
            }
            
            setSignError(errorMessage);
          }
        }
      } catch (confirmError: any) {
        console.warn("Lỗi khi xác nhận giao dịch:", confirmError);
        setSignError(`Lỗi xác nhận giao dịch: ${confirmError.message}`);
      }
      
      // Sau khi ký đề xuất thành công:
      setSignSuccess(`Đã ký đề xuất thành công với signature: ${txSignature}`);
      setSigningLoading(false);
      
      // Thêm dòng này để refresh danh sách đề xuất sau khi ký
      if (walletAddress) {
        fetchProposals(walletAddress);
      }
      
    } catch (error: any) {
      console.error('Lỗi khi ký đề xuất:', error);
      
      // Xử lý và hiển thị lỗi chi tiết từ blockchain
      let errorMessage = "Lỗi khi ký đề xuất";
      
      // Lấy logs từ kết quả simulation nếu có
      if (error.logs) {
        console.error("Logs từ blockchain:", error.logs);
        errorMessage += "\n\nChi tiết từ blockchain:\n" + error.logs.join('\n');
      }
      
      // Phân tích thông tin lỗi cụ thể để hiển thị thông báo dễ hiểu
      if (error.message.includes("custom program error: 0x")) {
        // Trích xuất mã lỗi
        const errorMatch = error.message.match(/custom program error: (0x[0-9a-fA-F]+)/);
        if (errorMatch && errorMatch[1]) {
          const errorCode = errorMatch[1];
          
          // Thêm giải thích cho mã lỗi cụ thể
          switch (errorCode) {
            case "0x1":
              errorMessage = "Lỗi khởi tạo không hợp lệ";
              break;
            case "0x2":
              errorMessage = "Lỗi tham số không hợp lệ";
              break;
            case "0x3":
              errorMessage = "Đề xuất đã tồn tại";
              break;
            case "0x4":
              errorMessage = "Đề xuất không tồn tại";
              break;
            case "0x5":
              errorMessage = "Guardian không hợp lệ";
              break;
            case "0x6":
              errorMessage = "Chữ ký không hợp lệ";
              break;
            case "0x7":
              errorMessage = "Không đủ chữ ký để thực thi";
              break;
            case "0x8":
              errorMessage = "Đề xuất đã được thực thi";
              break;
            default:
              errorMessage = `Lỗi chương trình: ${errorCode}`;
          }
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setSignError(errorMessage);
      setSigningLoading(false);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Typography variant="h4">
          Danh sách đề xuất giao dịch
        </Typography>
        <div className="flex items-center space-x-2">
          <button 
            onClick={() => walletAddress && fetchProposals(walletAddress)} 
            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Cập nhật
          </button>
          <button 
          onClick={goToHome}
            className="px-3 py-1.5 bg-gray-800 text-white rounded hover:bg-gray-700 transition-colors"
        >
            Quay lại
          </button>
        </div>
      </Box>

      {signError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSignError(null)}>
          {signError}
        </Alert>
      )}
      
      {signSuccess && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSignSuccess(null)}>
          {signSuccess}
        </Alert>
      )}
      
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
          <CircularProgress />
        </Box>
      ) : noWalletFound ? (
        <Box sx={{ textAlign: 'center', my: 4, p: 4, border: '1px solid #eee', borderRadius: 2 }}>
          <Typography variant="h6" gutterBottom>Không tìm thấy thông tin ví</Typography>
          <Typography variant="body1" sx={{ mb: 3 }}>
            Bạn cần đăng nhập hoặc tạo ví đa chữ ký trước khi xem danh sách đề xuất.
          </Typography>
          <Button 
            variant="contained" 
            onClick={goToHome}
          >
            Đến trang đăng nhập / tạo ví
          </Button>
        </Box>
      ) : proposals.length === 0 ? (
        <Box sx={{ textAlign: 'center', my: 4, p: 4, border: '1px solid #eee', borderRadius: 2 }}>
          <Typography variant="h6">Chưa có đề xuất nào</Typography>
          <Typography variant="body1" sx={{ mt: 2 }}>
            Quay lại trang chính để tạo đề xuất mới.
          </Typography>
          <Button 
            variant="contained" 
            onClick={goToHome}
            sx={{ mt: 2 }}
          >
            Quay lại trang chính
          </Button>
        </Box>
      ) : (
        <Stack spacing={2} sx={{ mt: 2 }}>
          {proposals.map((proposal) => (
            <MuiBox 
              key={proposal.proposalId.toString()} 
              sx={{ width: '100%' }}
            >
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Typography variant="h6">
                      {proposal.description}
                    </Typography>
                    <Chip 
                      label={getProposalStatus(proposal.status)}
                      color={
                        proposal.status === 'pending' ? 'warning' :
                        proposal.status === 'executed' ? 'success' :
                        proposal.status === 'rejected' ? 'error' : 'default'
                      }
                    />
                  </Box>
                  
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <AccessTimeIcon fontSize="small" sx={{ mr: 1 }} />
                    <Typography variant="body2" color="text.secondary">
                      {proposal.createdAt && proposal.createdAt.toDate ? 
                        formatTimestamp(proposal.createdAt.toDate().getTime()) : 
                        'Thời gian không xác định'}
                        </Typography>
                      </Box>
                      
                  {proposal.action === 'transfer' && proposal.amount && proposal.destination && (
                    <Box sx={{ bgcolor: 'background.paper', p: 2, borderRadius: 1, mb: 2 }}>
                      <Typography variant="body2" gutterBottom>
                        Chuyển khoản:
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="body1" fontWeight="bold">
                          {formatLamportsToSOL(proposal.amount)} SOL
                          </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <ArrowForwardIcon sx={{ mx: 1 }} />
                          <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                            {proposal.destination.slice(0, 4)}...{proposal.destination.slice(-4)}
                          </Typography>
                        </Box>
                      </Box>
                        </Box>
                      )}
                      
                  <Divider sx={{ my: 1 }} />
                  
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                      <Typography variant="body2">
                        Người tạo: {proposal.creator.slice(0, 4)}...{proposal.creator.slice(-4)}
                      </Typography>
                      <Typography variant="body2">
                        Chữ ký: {proposal.signers ? proposal.signers.length : 0}/{proposal.requiredSignatures}
                      </Typography>
                    </Box>
                    
                    <Box sx={{ display: 'flex', gap: 2 }}>
                      {proposal.status === 'pending' && !hasCurrentUserSigned(proposal) && (
                        <Button 
                          variant="contained" 
                          color="primary"
                          startIcon={<VerifiedUserIcon />}
                          onClick={() => openSignConfirmDialog(proposal)}
                          disabled={signingLoading}
                          size="small"
                        >
                          {signingLoading && currentSigningProposal?.proposalId === proposal.proposalId ? 
                            <CircularProgress size={24} /> : 'Ký đề xuất'}
                        </Button>
                      )}
                      
                      {proposal.status === 'pending' && hasEnoughSignatures(proposal) && (
                        <Button 
                          variant="contained" 
                          color="success"
                          startIcon={<PlayArrowOutlined />}
                          onClick={() => handleExecuteProposal(Number(proposal.proposalId))}
                          disabled={signingLoading}
                          size="small"
                        >
                          {signingLoading && currentSigningProposal?.proposalId === proposal.proposalId ? 
                            <CircularProgress size={24} /> : 'Thực thi'}
                        </Button>
                      )}
                      
                      <Button 
                        variant="outlined" 
                        onClick={() => handleViewProposal(Number(proposal.proposalId))}
                        size="small"
                      >
                        Xem chi tiết
                      </Button>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </MuiBox>
          ))}
        </Stack>
      )}
      
      {/* Dialog xác nhận ký đề xuất */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
      >
        <DialogTitle>Xác nhận ký đề xuất</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Bạn có chắc chắn muốn ký đề xuất này? Hành động này không thể hoàn tác.
          </DialogContentText>
          {currentSigningProposal && currentSigningProposal.action === 'transfer' && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
              <Typography variant="subtitle2" gutterBottom>
                Chi tiết giao dịch:
              </Typography>
              <Typography variant="body2">
                Số tiền: <b>{formatLamportsToSOL(currentSigningProposal.amount || 0)} SOL</b>
              </Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                Người nhận: <b>{currentSigningProposal.destination ? 
                  `${currentSigningProposal.destination.slice(0, 6)}...${currentSigningProposal.destination.slice(-6)}` : 
                  'Không xác định'}</b>
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Hủy</Button>
          <Button 
            onClick={handleSignProposal} 
            variant="contained" 
            color="primary"
          >
            Ký đề xuất
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default ProposalList; 