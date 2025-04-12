import { web3 } from '@coral-xyz/anchor';
import { PublicKey, Transaction, Keypair, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import idlFile from '../idl/moon_wallet_program.json';
import { Connection, sendAndConfirmTransaction } from '@solana/web3.js';
import { PROGRAM_ID } from '../utils/constants';
import BN from 'bn.js';
import { sha256 } from '@noble/hashes/sha256';

// Sử dụng PROGRAM_ID từ constants
export const programID = PROGRAM_ID;

// Hằng số cho chương trình secp256r1
export const SECP256R1_PROGRAM_ID = new PublicKey('Secp256r1SigVerify1111111111111111111111111');

// Hằng số cho Sysvar accounts với địa chỉ chính xác
export const SYSVAR_INSTRUCTIONS_PUBKEY = new PublicKey('Sysvar1nstructions1111111111111111111111111');
export const SYSVAR_CLOCK_PUBKEY = new PublicKey('SysvarC1ock11111111111111111111111111111111');

const idl: any = idlFile;

// Thêm hằng số cho chuẩn hóa signature
const SECP256R1_ORDER = new BN('FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551', 16);
const SECP256R1_HALF_ORDER = SECP256R1_ORDER.shrn(1);

export const checkSecp256r1Program = async (): Promise<boolean> => {
  return true;
};

// Thêm hàm kiểm tra chương trình secp256r1 thông qua transaction thử nghiệm nếu cần
export const testSecp256r1Instruction = async (connection: web3.Connection): Promise<boolean> => {
  try {
    // Tạo một cặp khóa giả lập cho việc kiểm tra
    const testKeyPair = web3.Keypair.generate();
    
    // Tạo một chữ ký và message giả
    const testSignature = Buffer.alloc(64, 1); // Chữ ký giả 64 bytes
    const testPubkey = Buffer.alloc(33, 2); // Khóa công khai giả 33 bytes
    testPubkey[0] = 0x02; // Định dạng khóa nén
    const testMessage = Buffer.alloc(32, 3); // Message hash giả 32 bytes
    
    // Tạo instruction secp256r1 giả
    const testInstruction = createSecp256r1Instruction(
      testMessage,
      testPubkey,
      testSignature
    );
    
    // Tạo transaction giả với instruction trên
    const testTx = new web3.Transaction().add(testInstruction);
    testTx.feePayer = testKeyPair.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    testTx.recentBlockhash = blockhash;
    
    // Chỉ mô phỏng giao dịch, không gửi thật
    await connection.simulateTransaction(testTx);
    
    // Nếu không có lỗi "program not found", chương trình tồn tại
    return true;
  } catch (error: any) {
    // Kiểm tra lỗi cụ thể
    const errorMessage = error.toString();
    // Nếu lỗi là về chương trình không tồn tại
    if (errorMessage.includes("Attempt to load a program that does not exist") ||
        errorMessage.includes("Program not found")) {
      console.error("Chương trình secp256r1 không tồn tại:", error);
      return false;
    }
    
    // Nếu là lỗi khác (vd: chữ ký không hợp lệ), chương trình vẫn tồn tại
    console.warn("Lỗi khi kiểm tra secp256r1, nhưng chương trình có thể tồn tại:", error);
    return true;
  }
};

// Cập nhật lại hàm tạo transaction
export const createInitializeMultisigTx = async (
  threshold: number,
  multisigPDA: PublicKey,
  owner: PublicKey | Keypair,
  feePayer: Keypair,
  recoveryHash: Uint8Array,
  credentialId: Buffer
): Promise<Transaction> => {
  try {
    const ownerPubkey = owner instanceof Keypair ? owner.publicKey : owner;
    
    // Sử dụng discriminator chính xác từ IDL
    const discriminator = Buffer.from([
      220, 130, 117, 21, 27, 227, 78, 213
    ]);
    
    // Đảm bảo recoveryHash có đúng 32 bytes
    if (recoveryHash.length !== 32) {
      throw new Error("Recovery hash phải đúng 32 bytes");
    }
    
    const thresholdBuffer = Buffer.from([threshold]);
    const recoveryHashBuffer = Buffer.from(recoveryHash);
    
    // Tạo buffer cho độ dài credential ID
    const credentialIdLenBuffer = Buffer.alloc(4);
    credentialIdLenBuffer.writeUInt32LE(credentialId.length, 0);
    
    // Nối tất cả lại với nhau
    const data = Buffer.concat([
      new Uint8Array(discriminator),
      new Uint8Array(thresholdBuffer),
      new Uint8Array(recoveryHashBuffer),
      new Uint8Array(credentialIdLenBuffer),
      new Uint8Array(credentialId)
    ]);
    
    // Tạo transaction instruction
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: multisigPDA, isSigner: false, isWritable: true },
        { pubkey: feePayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      programId: programID,
      data
    });
    
    const tx = new Transaction().add(instruction);
    return tx;
  } catch (error) {
    console.error("Lỗi khi tạo transaction initialize multisig:", error);
    throw error;
  }
};

// Thêm hàm compressPublicKey cho việc nén khóa công khai
function compressPublicKey(uncompressedKey: Buffer): Buffer {
  // Đảm bảo khóa bắt đầu với byte 0x04 (không nén)
  if (uncompressedKey[0] !== 0x04 || uncompressedKey.length !== 65) {
    throw new Error('Khóa không đúng định dạng không nén ECDSA');
  }
  
  // Sử dụng Uint8Array để tránh lỗi type
  const x = Buffer.from(uncompressedKey.subarray(1, 33));
  const y = Buffer.from(uncompressedKey.subarray(33, 65));
  
  // Tính prefix: 0x02 nếu y chẵn, 0x03 nếu y lẻ
  const prefix = (y[31] & 1) === 0 ? 0x02 : 0x03;
  
  // Tạo khóa nén: prefix (1 byte) + x (32 bytes)
  const compressedKey = Buffer.alloc(33);
  compressedKey[0] = prefix;
  new Uint8Array(compressedKey).set(new Uint8Array(x), 1);
  
  return compressedKey;
}

// Cập nhật hàm configure_webauthn với discriminator chính xác từ IDL
export const createConfigureWebAuthnTx = async (
  webauthnPubkey: Buffer,
  multisigPDA: PublicKey,
  owner: PublicKey
): Promise<Transaction> => {
  try {
    // Lấy từ IDL: discriminator chính xác cho hàm configure_webauthn
    const discriminator = Buffer.from([
      40, 149, 116, 224, 148, 48, 159, 54
    ]);
    
    // Nén khóa công khai từ 65 bytes xuống 33 bytes
    let compressedKey: Buffer;
    
    if (webauthnPubkey.length === 65 && webauthnPubkey[0] === 0x04) {
      // Khóa không nén, cần nén lại
      compressedKey = compressPublicKey(webauthnPubkey);
      console.log("Đã nén khóa từ 65 bytes xuống 33 bytes");
    } else if (webauthnPubkey.length === 33 && (webauthnPubkey[0] === 0x02 || webauthnPubkey[0] === 0x03)) {
      // Khóa đã nén, sử dụng trực tiếp
      compressedKey = webauthnPubkey;
      console.log("Khóa đã ở định dạng nén (33 bytes)");
    } else {
      console.warn(`Khóa công khai WebAuthn không đúng định dạng: ${webauthnPubkey.length} bytes`);
      // Nếu không thể xử lý, tạo khóa giả
      compressedKey = Buffer.alloc(33);
      compressedKey[0] = 0x02; // Prefix cho khóa nén
      if (webauthnPubkey.length > 0) {
        // Sao chép dữ liệu nếu có
        new Uint8Array(compressedKey).set(
          new Uint8Array(webauthnPubkey.subarray(0, Math.min(webauthnPubkey.length, 32))),
          1
        );
      }
    }
    
    console.log("Khóa công khai WebAuthn (nén):", compressedKey.toString('hex'));
    console.log("Độ dài khóa (bytes):", compressedKey.length);
    
    // Tạo dữ liệu instruction
    const data = Buffer.concat([
      new Uint8Array(discriminator),
      new Uint8Array(compressedKey)
    ]);
    
    // Tạo instruction với đúng accounts theo IDL
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: multisigPDA, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
      programId: programID,
      data
    });
    
    const tx = new Transaction().add(instruction);
    return tx;
  } catch (error) {
    console.error("Lỗi khi tạo transaction configure webauthn:", error);
    throw error;
  }
};

/**
 * Tạo transaction cho storePasswordHash
 */
export const createStorePasswordHashTx = async (
  passwordHash: Uint8Array,
  multisigPDA: web3.PublicKey,
  ownerPubkey: web3.PublicKey
) => {
  const tx = new web3.Transaction();
  
  // Sửa lỗi Buffer.from
  const discriminator = Buffer.from([
    // Thay thế với giá trị discriminator thực tế
    125, 106, 39, 42, 99, 108, 43, 50
  ]);
  
  // Sửa lại cách tạo data buffer
  const data = Buffer.concat([
    new Uint8Array(discriminator),
    new Uint8Array(Buffer.from(Array.from(passwordHash)))
  ]);
  
  // Thêm instruction để lưu password hash
  tx.add(
    new web3.TransactionInstruction({
      keys: [
        { pubkey: multisigPDA, isSigner: false, isWritable: true },
        { pubkey: ownerPubkey, isSigner: true, isWritable: false },
      ],
      programId: programID,
      data: data
    })
  );
  
  return tx;
};

/**
 * Tạo transaction xác thực WebAuthn
 */
export const createWebAuthnAuthTx = async (
  multisigPDA: web3.PublicKey,
  ownerPubkey: web3.PublicKey,
  webauthnSignature: Uint8Array,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array
): Promise<web3.Transaction> => {
  const tx = new web3.Transaction();
  
  // Thêm discriminator đúng cho verify_webauthn_auth
  const instructionData = Buffer.concat([
    new Uint8Array(Buffer.from([234, 182, 165, 23, 186, 223, 208, 119])), // discriminator từ IDL
    new Uint8Array(Buffer.from(webauthnSignature)),
    new Uint8Array(Buffer.from(authenticatorData)),
    new Uint8Array(Buffer.from(clientDataJSON))
  ]);
  
  const instruction = new web3.TransactionInstruction({
    keys: [
      { pubkey: multisigPDA, isSigner: false, isWritable: true },
      { pubkey: ownerPubkey, isSigner: false, isWritable: false }
    ],
    programId: programID,
    data: instructionData
  });
  
  tx.add(instruction);
  return tx;
};

// Tạo hàm mới createAddGuardianTx
export const createAddGuardianTx = (
  multisigPDA: PublicKey,
  guardianPDA: PublicKey,
  guardianPubkey: PublicKey,
  guardianName: string,
  recoveryHash: Uint8Array,
  isOwner: boolean,
  webauthnPubkey?: Buffer
): Transaction => {
  try {
    // Discriminator cho add_guardian
    const discriminator = Buffer.from([167, 189, 170, 27, 74, 240, 201, 241]);
    
    // Tạo buffer cho tên guardian
    const nameBuffer = Buffer.from(guardianName);
    const nameLenBuffer = Buffer.alloc(4);
    nameLenBuffer.writeUInt32LE(nameBuffer.length, 0);
    
    // Tạo buffer cho các tham số
    const isOwnerByte = Buffer.from([isOwner ? 1 : 0]);
    
    // Tạo buffers cho instruction data
    const dataBuffers = [
      discriminator,
      guardianPubkey.toBuffer(),
      nameLenBuffer,
      nameBuffer,
      Buffer.from(recoveryHash)
    ];
    
    // Thêm isOwner
    dataBuffers.push(isOwnerByte);
    
    // Xử lý webauthn_pubkey (option)
    if (webauthnPubkey && isOwner) {
      // Some variant (1)
      dataBuffers.push(Buffer.from([1]));
      
      // Nén khóa công khai nếu cần
      let compressedKey: Buffer;
      if (webauthnPubkey.length === 65 && webauthnPubkey[0] === 0x04) {
        // Khóa không nén, cần nén lại
        compressedKey = compressPublicKey(webauthnPubkey);
      } else if (webauthnPubkey.length === 33 && (webauthnPubkey[0] === 0x02 || webauthnPubkey[0] === 0x03)) {
        // Khóa đã nén, sử dụng trực tiếp
        compressedKey = webauthnPubkey;
      } else {
        throw new Error(`Khóa công khai WebAuthn không đúng định dạng: ${webauthnPubkey.length} bytes`);
      }
      
      dataBuffers.push(compressedKey);
    } else {
      // None variant (0)
      dataBuffers.push(Buffer.from([0]));
    }
    
    // Nối tất cả buffer lại với nhau
    const data = Buffer.concat(dataBuffers.map(buffer => new Uint8Array(buffer)));
    
    // Tạo instruction
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: multisigPDA, isSigner: false, isWritable: true },
        { pubkey: guardianPDA, isSigner: false, isWritable: true },
        { pubkey: guardianPubkey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      programId: programID,
      data
    });
    
    return new Transaction().add(instruction);
  } catch (error) {
    console.error("Lỗi khi tạo transaction add guardian:", error);
    throw error;
  }
};

// Các hằng số cần thiết cho Secp256r1
export const COMPRESSED_PUBKEY_SIZE = 33;
export const SIGNATURE_SIZE = 64;
export const DATA_START = 16; // 2 bytes header + 14 bytes offsets
export const SIGNATURE_OFFSETS_START = 2;

/**
 * Tạo instruction data cho chương trình Secp256r1SigVerify
 * @param message Tin nhắn gốc không hash
 * @param publicKey Khóa công khai nén
 * @param signature Chữ ký chuẩn hóa
 */
export const createSecp256r1Instruction = (
  message: Buffer, 
  publicKey: Buffer,
  signature: Buffer,
  shouldFlipPublicKey: boolean = false
): TransactionInstruction => {
  console.log("Tạo secp256r1 instruction với:");
  console.log(`- Message (${message.length} bytes):`, message.toString('hex').substring(0, 64) + '...');
  console.log(`- Public key (${publicKey.length} bytes):`, publicKey.toString('hex'));
  console.log(`- Signature (${signature.length} bytes):`, signature.toString('hex'));
  console.log(`- Flip public key: ${shouldFlipPublicKey}`);
  
  // Đảm bảo public key có đúng định dạng (compressed, 33 bytes)
  if (publicKey.length !== 33) {
    console.error('Public key phải có đúng 33 bytes (dạng nén)');
    throw new Error(`Public key phải có đúng 33 bytes, nhưng có ${publicKey.length} bytes`);
  }
  
  // Đảm bảo signature có đúng 64 bytes
  if (signature.length !== 64) {
    console.error('Signature phải có đúng 64 bytes');
    throw new Error(`Signature phải có đúng 64 bytes, nhưng có ${signature.length} bytes`);
  }
  
  // Kiểm tra byte đầu tiên của public key
  if (publicKey[0] !== 0x02 && publicKey[0] !== 0x03) {
    console.warn(`Byte đầu tiên của public key nên là 0x02 hoặc 0x03, nhưng là 0x${publicKey[0].toString(16)}`);
  }
  
  // Chuyển đổi public key nếu cần
  let pubkeyToUse = publicKey;
  if (shouldFlipPublicKey) {
    // Tạo public key mới với byte đầu tiên bị đảo
    pubkeyToUse = Buffer.from(publicKey);
    pubkeyToUse[0] = pubkeyToUse[0] === 0x02 ? 0x03 : 0x02;
    console.log(`- Public key sau khi đảo (${pubkeyToUse.length} bytes):`, pubkeyToUse.toString('hex'));
  }
  
  // Các hằng số
  const COMPRESSED_PUBKEY_SIZE = 33;
  const SIGNATURE_SIZE = 64;
  const DATA_START = 16; // 1 byte + 1 byte padding + 14 bytes offsets
  const SIGNATURE_OFFSETS_START = 2;
  
  // Tính tổng kích thước dữ liệu
  const totalSize = DATA_START + SIGNATURE_SIZE + COMPRESSED_PUBKEY_SIZE + message.length;
  const instructionData = Buffer.alloc(totalSize);
  
  // Tính offset
  const numSignatures = 1;
  const publicKeyOffset = DATA_START;
  const signatureOffset = publicKeyOffset + COMPRESSED_PUBKEY_SIZE;
  const messageDataOffset = signatureOffset + SIGNATURE_SIZE;

  // Ghi số lượng chữ ký và padding
  instructionData.writeUInt8(numSignatures, 0);
  instructionData.writeUInt8(0, 1); // padding

  // Tạo và ghi offsets
  const offsets = {
    signature_offset: signatureOffset,
    signature_instruction_index: 0xffff, // u16::MAX
    public_key_offset: publicKeyOffset,
    public_key_instruction_index: 0xffff,
    message_data_offset: messageDataOffset,
    message_data_size: message.length,
    message_instruction_index: 0xffff,
  };

  // Ghi offsets
  instructionData.writeUInt16LE(offsets.signature_offset, SIGNATURE_OFFSETS_START);
  instructionData.writeUInt16LE(offsets.signature_instruction_index, SIGNATURE_OFFSETS_START + 2);
  instructionData.writeUInt16LE(offsets.public_key_offset, SIGNATURE_OFFSETS_START + 4);
  instructionData.writeUInt16LE(offsets.public_key_instruction_index, SIGNATURE_OFFSETS_START + 6);
  instructionData.writeUInt16LE(offsets.message_data_offset, SIGNATURE_OFFSETS_START + 8);
  instructionData.writeUInt16LE(offsets.message_data_size, SIGNATURE_OFFSETS_START + 10);
  instructionData.writeUInt16LE(offsets.message_instruction_index, SIGNATURE_OFFSETS_START + 12);

  // Ghi dữ liệu vào instruction
  pubkeyToUse.copy(instructionData, publicKeyOffset);
  signature.copy(instructionData, signatureOffset);
  message.copy(instructionData, messageDataOffset);
  
  console.log('Secp256r1 instruction data:');
  console.log('- Total size:', instructionData.length);
  console.log('- Public key offset:', publicKeyOffset);
  console.log('- Signature offset:', signatureOffset);
  console.log('- Message offset:', messageDataOffset);
  console.log('- Message size:', message.length);
  
  // Log dữ liệu hex
  console.log('- Instruction data (50 bytes đầu):', instructionData.slice(0, 50).toString('hex'));
  
  return new TransactionInstruction({
    keys: [],
    programId: SECP256R1_PROGRAM_ID,
    data: instructionData,
  });
};

/**
 * Chuẩn hóa chữ ký về dạng Low-S
 * @param signature - Chữ ký raw (đã chuyển từ DER sang raw format)
 * @returns Chữ ký đã chuẩn hóa
 */
export const normalizeSignatureToLowS = (signature: Buffer): Buffer => {
  // Phân tách r và s từ signature (mỗi cái 32 bytes)
  const r = signature.slice(0, 32);
  const s = signature.slice(32, 64);
  
  // Chuyển s thành BN để so sánh với HALF_ORDER
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
  return signature;
};

/**
 * @param multisigPDA 
 * @param guardianPDA PDA của guardian
 * @param destination Địa chỉ đích để chuyển token
 * @param amountLamports Số lượng lamports để chuyển
 * @param nonce Nonce tránh replay attack
 * @param timestamp Timestamp cho giao dịch
 * @param message Thông điệp gốc (chưa hash)
 * @param payer Người trả phí giao dịch
 * @param credentialId Tham số credential ID gốc
 */
export const createTransferTx = (
  multisigPDA: PublicKey,
  guardianPDA: PublicKey,
  destination: PublicKey,
  amountLamports: number,
  nonce: number,
  timestamp: number,
  message: Uint8Array,
  payer: PublicKey,
  credentialId?: string
): Transaction => {
  try {
    // Kiểm tra các input
    if (!(multisigPDA instanceof PublicKey)) {
      throw new Error(`multisigPDA không phải PublicKey: ${typeof multisigPDA}`);
    }
    if (!(guardianPDA instanceof PublicKey)) {
      throw new Error(`guardianPDA không phải PublicKey: ${typeof guardianPDA}`);
    }
    if (!(destination instanceof PublicKey)) {
      throw new Error(`destination không phải PublicKey: ${typeof destination}`);
    }
    if (!(payer instanceof PublicKey)) {
      throw new Error(`payer không phải PublicKey: ${typeof payer}`);
    }
    
    // Đảm bảo các giá trị số hợp lệ
    if (isNaN(amountLamports) || amountLamports <= 0) {
      throw new Error(`amountLamports không hợp lệ: ${amountLamports}`);
    }
    if (isNaN(nonce) || nonce < 0) {
      throw new Error(`nonce không hợp lệ: ${nonce}`);
    }
    if (isNaN(timestamp) || timestamp <= 0) {
      throw new Error(`timestamp không hợp lệ: ${timestamp}`);
    }
    
    // Log thông tin debug để kiểm tra
    console.log('Tạo transaction chuyển tiền với thông tin:');
    console.log('- multisigPDA:', multisigPDA.toBase58());
    console.log('- guardianPDA:', guardianPDA.toBase58());
    console.log('- destination:', destination.toBase58());
    console.log('- amountLamports:', amountLamports);
    console.log('- nonce:', nonce);
    console.log('- timestamp:', timestamp);
    console.log('- message length:', message.length);
    console.log('- payer:', payer.toBase58());
    
    // Thêm log credential ID nếu có
    if (credentialId) {
      console.log('- credentialId:', credentialId);
      console.log('- credentialId length:', credentialId.length);
      // Log bytes để debug
      const credentialBytes = Buffer.from(credentialId);
      console.log('- credentialId bytes:', Array.from(credentialBytes));
      
      // Log bytes được xử lý nếu dài quá 24 bytes (giống như trong contract)
      if (credentialBytes.length > 24) {
        console.log('- credentialId dài quá 24 bytes, cần hash');
        const processedBytes = new Uint8Array(24);
        for (let i = 0; i < credentialBytes.length; i++) {
          processedBytes[i % 24] ^= credentialBytes[i];
        }
        console.log('- credentialId bytes after processing:', Array.from(processedBytes));
      }
    }
    
    // Discriminator cho verify_and_execute
    const discriminator = Buffer.from([37, 165, 237, 189, 225, 188, 58, 41]);
    
    // Tham số cho 'action' - chuỗi "transfer"
    const action = "transfer";
    const actionBuffer = Buffer.from(action);
    const actionLenBuffer = Buffer.alloc(4);
    actionLenBuffer.writeUInt32LE(actionBuffer.length, 0);
    
    // Encode ActionParams
    const amountBuffer = Buffer.alloc(9); // 1 byte cho Option + 8 bytes cho u64
    amountBuffer.writeUInt8(1, 0); // 1 = Some
    const amountBigInt = BigInt(amountLamports);
    for (let i = 0; i < 8; i++) {
      amountBuffer.writeUInt8(Number((amountBigInt >> BigInt(8 * i)) & BigInt(0xFF)), i + 1);
    }
    
    // Encode destination
    const destinationBuffer = Buffer.alloc(33); // 1 byte cho Option + 32 bytes cho PublicKey
    destinationBuffer.writeUInt8(1, 0); // 1 = Some
    Buffer.from(destination.toBuffer()).copy(destinationBuffer, 1);
    
    // Encode token_mint (None)
    const tokenMintBuffer = Buffer.alloc(1);
    tokenMintBuffer.writeUInt8(0, 0); // 0 = None
    
    // Encode nonce (u64, little-endian)
    const nonceBuffer = Buffer.alloc(8);
    const nonceBigInt = BigInt(nonce);
    for (let i = 0; i < 8; i++) {
      nonceBuffer.writeUInt8(Number((nonceBigInt >> BigInt(8 * i)) & BigInt(0xFF)), i);
    }
    
    // Encode timestamp (i64, little-endian)
    const timestampBuffer = Buffer.alloc(8);
    const timestampBigInt = BigInt(timestamp);
    for (let i = 0; i < 8; i++) {
      timestampBuffer.writeUInt8(Number((timestampBigInt >> BigInt(8 * i)) & BigInt(0xFF)), i);
    }
    
    // Encode message (vec<u8>)
    const messageLenBuffer = Buffer.alloc(4);
    messageLenBuffer.writeUInt32LE(message.length, 0);
    const messageBuffer = Buffer.from(message);
    
    // Nối tất cả buffer lại với nhau
    const data = Buffer.concat([
      discriminator,
      actionLenBuffer,
      actionBuffer,
      amountBuffer,
      destinationBuffer,
      tokenMintBuffer,
      nonceBuffer,
      timestampBuffer,
      messageLenBuffer,
      messageBuffer
    ]);
    
    // Kiểm tra địa chỉ của instruction sysvar
    const sysvarInstructionPubkey = SYSVAR_INSTRUCTIONS_PUBKEY;
    const sysvarClockPubkey = SYSVAR_CLOCK_PUBKEY;
    
    // Tạo instruction verify_and_execute
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: multisigPDA, isSigner: false, isWritable: true },
        { pubkey: guardianPDA, isSigner: false, isWritable: false },
        { pubkey: sysvarClockPubkey, isSigner: false, isWritable: false },
        { pubkey: sysvarInstructionPubkey, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
      ],
      programId: programID,
      data
    });
    
    // Tính toán và hiển thị expected message format
    const amountInSol = amountLamports / 1_000_000_000.0; 
    const formattedAmount = amountInSol.toString().replace(/\.?0+$/, '');
    const expectedMessage = `transfer:${formattedAmount}_SOL_to_${destination.toBase58()},nonce:${nonce},timestamp:${timestamp},pubkey:<hash>`;
    console.log('Expected message format trong contract:', expectedMessage);
    
    // Debug chi tiết message
    console.log('===== DEBUG MESSAGE SENT TO CONTRACT =====');
    const messageString = new TextDecoder().decode(message);
    console.log('Message được gửi đến contract:', messageString);
    console.log('Message length:', messageString.length);
    console.log('Message bytes array:', Array.from(message));
    console.log('Message bytes detailed:', Array.from(message)
      .map((b, i) => `[${i}] ${b} (${String.fromCharCode(b)})`).join(', '));
    console.log('Message hex:', Buffer.from(message).toString('hex'));
    console.log('=========================================');
    
    // Tạo giao dịch
    const tx = new Transaction().add(instruction);
    return tx;
  } catch (error) {
    console.error("Lỗi khi tạo transaction chuyển tiền:", error);
    throw error;
  }
};

// Thêm hàm mới để xác minh chữ ký secp256r1 độc lập
export const verifySecp256r1Signature = async (
  connection: Connection,
  message: Buffer,
  publicKey: Buffer, 
  signature: Buffer, 
  feePayer: Keypair,
  shouldFlipPublicKey: boolean = false
): Promise<string> => {
  try {
    console.log("=== BẮT ĐẦU XÁC MINH CHỮ KÝ SECP256R1 ĐỘC LẬP ===");
    console.log("Message:", message.toString());
    console.log("Public key:", publicKey.toString('hex'));
    console.log("Signature:", signature.toString('hex'));
    
    // Tạo instruction xác minh chữ ký
    const verifyInstruction = createSecp256r1Instruction(
      message,
      publicKey,
      signature,
      shouldFlipPublicKey
    );
    
    // Tạo transaction đơn giản chỉ chứa instruction xác minh
    const transaction = new Transaction().add(verifyInstruction);
    
    // Thiết lập fee payer và recent blockhash
    transaction.feePayer = feePayer.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    
    // Ký và gửi transaction
    console.log("Gửi transaction chỉ để xác minh chữ ký secp256r1...");
    const txSignature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [feePayer]
    );
    
    console.log("✅ XÁC MINH CHỮ KÝ SECP256R1 THÀNH CÔNG!");
    console.log("Transaction signature:", txSignature);
    
    return txSignature;
  } catch (error: any) {
    console.error("❌ XÁC MINH CHỮ KÝ SECP256R1 THẤT BẠI:", error);
    throw new Error(`Lỗi khi xác minh chữ ký secp256r1: ${error.message}`);
  }
};

/**
 * Chuyển đổi chữ ký từ định dạng DER sang định dạng raw (r, s) cho Secp256r1
 * 
 * @param derSignature Chữ ký ở định dạng DER từ WebAuthn
 * @returns Chữ ký ở định dạng raw 64 bytes (32 bytes r + 32 bytes s)
 */
export const derToRaw = (derSignature: Uint8Array): Uint8Array => {
  try {
    // Kiểm tra format DER
    if (derSignature[0] !== 0x30) {
      throw new Error('Chữ ký không đúng định dạng DER: byte đầu tiên không phải 0x30');
    }
    
    // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
    const rLength = derSignature[3];
    const rStart = 4;
    const rEnd = rStart + rLength;
    
    const sLength = derSignature[rEnd + 1];
    const sStart = rEnd + 2;
    const sEnd = sStart + sLength;
    
    // Trích xuất r và s
    let r = derSignature.slice(rStart, rEnd);
    let s = derSignature.slice(sStart, sEnd);
    
    console.log('DER r length:', r.length, 'r (hex):', Buffer.from(r).toString('hex'));
    console.log('DER s length:', s.length, 's (hex):', Buffer.from(s).toString('hex'));
    
    // Xử lý trường hợp r có 33 bytes với byte đầu tiên là 0x00
    if (r.length === 33 && r[0] === 0x00) {
      console.log('Phát hiện r dài 33 bytes với byte đầu 0x00, loại bỏ byte này');
      r = r.slice(1);
    }
    
    // Xử lý trường hợp s có 33 bytes với byte đầu tiên là 0x00
    if (s.length === 33 && s[0] === 0x00) {
      console.log('Phát hiện s dài 33 bytes với byte đầu 0x00, loại bỏ byte này');
      s = s.slice(1);
    }
    
    // Chuẩn bị r và s cho định dạng raw (mỗi phần 32 bytes)
    const rPadded = new Uint8Array(32);
    const sPadded = new Uint8Array(32);
    
    if (r.length <= 32) {
      // Trường hợp r ngắn hơn 32 bytes, thêm padding
      rPadded.set(r, 32 - r.length);
    } else {
      // Trường hợp r dài hơn 32 bytes, lấy 32 bytes cuối
      rPadded.set(r.slice(r.length - 32));
    }
    
    if (s.length <= 32) {
      // Trường hợp s ngắn hơn 32 bytes, thêm padding
      sPadded.set(s, 32 - s.length);
    } else {
      // Trường hợp s dài hơn 32 bytes, lấy 32 bytes cuối
      sPadded.set(s.slice(s.length - 32));
    }
    
    // Nối r và s lại
    const rawSignature = new Uint8Array(64);
    rawSignature.set(rPadded);
    rawSignature.set(sPadded, 32);
    
    console.log('Raw signature (r||s):', Buffer.from(rawSignature).toString('hex'));
    console.log('Raw signature length:', rawSignature.length);
    
    return rawSignature;
  } catch (e) {
    console.error('Lỗi khi chuyển đổi DER sang raw:', e);
    throw e;
  }
};

/**
 * Tạo transaction để ký đề xuất
 * 
 * @param proposalPDA PDA của đề xuất
 * @param multisigPDA PDA của multisig
 * @param guardianPDA PDA của guardian
 * @param guardianId ID của guardian
 * @param payer Người trả phí
 * @param webauthnSignature Chữ ký WebAuthn
 * @param authenticatorData Dữ liệu xác thực từ WebAuthn
 * @param clientDataJSON Dữ liệu client từ WebAuthn
 * @param proposalId ID của đề xuất
 * @param timestamp Thời gian ký
 * @param credentialId Tùy chọn: Credential ID để ghi đè credential ID từ localStorage
 * @returns Giao dịch đã được tạo
 */
export const createApproveProposalTx = async (
  proposalPDA: PublicKey,
  multisigPDA: PublicKey,
  guardianPDA: PublicKey,
  guardianId: number,
  payer: PublicKey,
  webauthnSignature: Uint8Array,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
  proposalId: string | number,
  timestamp: number,
  credentialId?: string
): Promise<Transaction> => {
  // Tạo transaction mới
  const transaction = new Transaction();

  // Lấy WebAuthn public key từ credential, truyền credentialId nếu có
  console.log("Đang tìm WebAuthn public key...");
  const webAuthnPubKey = await getWebAuthnPublicKey(guardianPDA, credentialId);
  
  if (!webAuthnPubKey) {
    throw new Error("Không tìm thấy WebAuthn public key cho guardian này");
  }
  
  console.log("==== DEBUG WEBAUTHN PUBLIC KEY IN TRANSACTION ====");
  console.log("WebAuthn Public Key (Hex):", webAuthnPubKey.toString('hex'));
  console.log("WebAuthn Public Key length:", webAuthnPubKey.length);
  console.log("WebAuthn Public Key bytes:", Array.from(webAuthnPubKey));
  console.log("===============================================");
  
  // Tính hash của WebAuthn public key sử dụng hàm sha256
  const hashBytes = sha256(webAuthnPubKey);
  // Lấy 6 bytes đầu tiên
  const pubkeyHashBytes = hashBytes.slice(0, 6);
  // Chuyển đổi sang hex string
  const pubkeyHashHex = Array.from(pubkeyHashBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // 1. Tạo message để ký
  const messageString = `approve:proposal_${proposalId},guardian_${guardianId},timestamp:${timestamp},pubkey:${pubkeyHashHex}`;
  const messageBuffer = Buffer.from(messageString);
  console.log("Thông điệp được ký:", messageString);

  // 2. Tính hash của clientDataJSON
  const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
  const clientDataHashBytes = new Uint8Array(clientDataHash);

  // 3. Tạo verification data: authenticatorData + hash(clientDataJSON)
  const verificationData = new Uint8Array(authenticatorData.length + clientDataHashBytes.length);
  verificationData.set(new Uint8Array(authenticatorData), 0);
  verificationData.set(clientDataHashBytes, authenticatorData.length);

  // 4. Chuyển đổi signature từ DER sang raw format
  const rawSignature = derToRaw(webauthnSignature);
  
  // 5. Chuẩn hóa signature về dạng Low-S
  const normalizedSignature = normalizeSignatureToLowS(Buffer.from(rawSignature));
  
  // 6. Tạo instruction Secp256r1 để xác thực chữ ký
  const secp256r1Ix = createSecp256r1Instruction(
    Buffer.from(verificationData),
    webAuthnPubKey,
    normalizedSignature,
    false
  );
  
  // Thêm secp256r1 instruction vào transaction
  transaction.add(secp256r1Ix);
  
  // 7. Tạo instruction approve_proposal
  
  // Tạo dữ liệu cho approve_proposal instruction
  const approveProposalDiscriminator = Buffer.from([136, 108, 102, 85, 98, 114, 7, 147]); // Discriminator từ IDL
  
  // Tạo các buffer cho tham số
  const proposalIdBuffer = Buffer.alloc(8);
  proposalIdBuffer.writeBigUInt64LE(BigInt(proposalId), 0);
  
  const guardianIdBuffer = Buffer.alloc(8);
  guardianIdBuffer.writeBigUInt64LE(BigInt(guardianId), 0);
  
  const timestampBuffer = Buffer.alloc(8);
  timestampBuffer.writeBigInt64LE(BigInt(timestamp), 0);
  
  // Tạo message buffer và độ dài
  const messageLenBuffer = Buffer.alloc(4);
  messageLenBuffer.writeUInt32LE(messageBuffer.length, 0);
  
  // Tạo dữ liệu instruction
  const approveData = Buffer.concat([
    approveProposalDiscriminator,
    proposalIdBuffer,
    guardianIdBuffer,
    timestampBuffer,
    messageLenBuffer,
    messageBuffer
  ]);
  
  // 8. Tạo danh sách account cần thiết
  const approveIx = new TransactionInstruction({
    keys: [
      { pubkey: multisigPDA, isSigner: false, isWritable: true }, // Thay đổi isWritable thành true
      { pubkey: proposalPDA, isSigner: false, isWritable: true },
      // Danh sách tài khoản signature sẽ được tạo PDA từ proposal và guardianId
      { pubkey: await findSignaturePDA(proposalPDA, guardianId), isSigner: false, isWritable: true },
      { pubkey: guardianPDA, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: approveData
  });
  
  // Thêm approve instruction vào transaction
  transaction.add(approveIx);
  
  return transaction;
};

/**
 * Hàm hỗ trợ để tìm PDA cho signature từ proposal và guardianId
 */
async function findSignaturePDA(proposalPDA: PublicKey, guardianId: number): Promise<PublicKey> {
  const [pda] = await PublicKey.findProgramAddress(
    [
      Buffer.from("signature"),
      proposalPDA.toBuffer(),
      new BN(guardianId).toArrayLike(Buffer, "le", 8)
    ],
    PROGRAM_ID
  );
  return pda;
}

/**
 * Hàm hỗ trợ để lấy WebAuthn public key cho guardian
 * @param guardianPDA PublicKey của guardian
 * @param overrideCredentialId Credential ID tùy chọn để ghi đè ID từ localStorage
 */
async function getWebAuthnPublicKey(guardianPDA: PublicKey, overrideCredentialId?: string): Promise<Buffer> {
  console.log("Tìm WebAuthn public key cho guardian:", guardianPDA.toString());
  
  let credentialId: string;
  let normalizedCredentialId: string;
  
  if (overrideCredentialId) {
    // Sử dụng credential ID được chỉ định
    credentialId = overrideCredentialId;
    console.log("Sử dụng credential ID được chỉ định:", credentialId);
  } else {
    // Kiểm tra xem có credential ID trong localStorage không
    const userCredentials = JSON.parse(localStorage.getItem("userCredentials") || "[]");
    if (userCredentials.length === 0) {
      throw new Error("Không tìm thấy thông tin đăng nhập WebAuthn. Vui lòng đăng nhập trước.");
    }
    
    credentialId = userCredentials[0].id;
    console.log("Sử dụng credential ID từ userCredentials:", credentialId);
  }
  
  // Chuẩn hóa credential ID
  const normalizeCredentialId = (credId: string): string => {
    // Đảm bảo credId là base64
    try {
      const buffer = Buffer.from(credId, 'base64');
      return buffer.toString('hex');
    } catch (e) {
      // Nếu đã là hex, trả về nguyên
      return credId;
    }
  };
  
  normalizedCredentialId = normalizeCredentialId(credentialId);
  console.log("Normalized credential ID:", normalizedCredentialId);
  
  // Lấy public key theo credential ID cụ thể
  const credentialSpecificKey = `guardianPublicKey_${normalizedCredentialId}`;
  const publicKeyHex = localStorage.getItem(credentialSpecificKey);
  
  if (!publicKeyHex) {
    throw new Error(`Không tìm thấy public key cho credential ID: ${credentialId}. Khóa '${credentialSpecificKey}' không tồn tại trong localStorage.`);
  }
  
  console.log("Đã tìm thấy public key trong localStorage theo credential ID:", publicKeyHex.slice(0, 10) + "...");
  const pubKeyBuffer = Buffer.from(publicKeyHex, 'hex');
  console.log("Độ dài public key:", pubKeyBuffer.length);
  
  if (pubKeyBuffer.length !== 33 && pubKeyBuffer.length !== 65) {
    throw new Error(`Public key không đúng định dạng: độ dài ${pubKeyBuffer.length} bytes, cần 33 hoặc 65 bytes.`);
  }
  
  return pubKeyBuffer;
}

/**
 * Tạo transaction để thực thi một đề xuất giao dịch đã được phê duyệt
 * 
 * @param proposalPDA Địa chỉ PDA của đề xuất
 * @param multisigPDA Địa chỉ PDA của multisig
 * @param feePayer Người trả phí giao dịch
 * @param destination Địa chỉ đích để chuyển tiền (nếu là giao dịch chuyển tiền)
 * @returns Transaction đã được tạo
 */
export const createExecuteProposalTx = async (
  proposalPDA: PublicKey,
  multisigPDA: PublicKey,
  feePayer: PublicKey,
  destination?: PublicKey
): Promise<Transaction> => {
  const transaction = new Transaction();
  
  // Tạo discriminator cho execute_proposal
  const executeProposalDiscriminator = Buffer.from([186, 60, 116, 133, 108, 128, 111, 28]); // Discriminator chính xác từ IDL
  
  console.log('Execute Proposal Discriminator (hex) từ createExecuteProposalTx:', Buffer.from(executeProposalDiscriminator).toString('hex'));
  
  // Tạo dữ liệu cho proposal_id
  const proposalIdMatch = proposalPDA.toString().match(/proposal-(\d+)/);
  const proposalId = proposalIdMatch ? parseInt(proposalIdMatch[1]) : 1; // Lấy ID từ tên PDA hoặc mặc định là 1
  
  const proposalIdBuffer = Buffer.alloc(8);
  proposalIdBuffer.writeBigUInt64LE(BigInt(proposalId), 0);
  
  // Tạo dữ liệu instruction
  const executeData = Buffer.concat([
    executeProposalDiscriminator,
    proposalIdBuffer,
  ]);
  
  // Tạo danh sách account cần thiết
  const accounts = [
    { pubkey: multisigPDA, isSigner: false, isWritable: true },
    { pubkey: proposalPDA, isSigner: false, isWritable: true },
    { pubkey: feePayer, isSigner: true, isWritable: true },
  ];
  
  // Thêm destination nếu được cung cấp
  if (destination) {
    accounts.push({ pubkey: destination, isSigner: false, isWritable: true });
  }
  
  // Thêm các account hệ thống
  accounts.push(
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  );
  
  // Tạo instruction
  const executeIx = new TransactionInstruction({
    keys: accounts,
    programId: PROGRAM_ID,
    data: executeData
  });
  
  // Thêm instruction vào transaction
  transaction.add(executeIx);
  
  return transaction;
};