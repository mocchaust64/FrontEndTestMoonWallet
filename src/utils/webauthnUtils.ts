import { bufferToHex } from './bufferUtils';
import * as CBOR from 'cbor-web';
import { PublicKey } from '@solana/web3.js';
import { processCredentialIdForPDA } from './helpers';

/**
 * Tạo WebAuthn credential mới
 */
export const createWebAuthnCredential = async (
  walletAddress: string,
  walletName?: string
): Promise<{credentialId: string, publicKey: string, rawId: Uint8Array}> => {
  try {
    if (!isWebAuthnSupported()) {
      throw new Error('WebAuthn không được hỗ trợ trên trình duyệt này');
    }

    // Tạo challenge ngẫu nhiên
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    
    // Tạo userID ngẫu nhiên cho mỗi ví để tránh ghi đè credentials
    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);
    
    // Đảm bảo có tên ví (quan trọng cho hiển thị trên hộp thoại trình duyệt)
    const walletDisplayName = walletName || `Moon Wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
    
    console.log(`Tạo credential với tên: "${walletDisplayName}"`);
    
    // Tạo options cho credential creation
    const options: PublicKeyCredentialCreationOptions = {
      challenge: challenge,
      rp: {
        name: 'Moon Wallet',
        id: window.location.hostname
      },
      user: {
        id: userId,
        name: walletDisplayName, // Sử dụng walletDisplayName cho cả name
        displayName: walletDisplayName // Và displayName
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 } // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'preferred', 
        requireResidentKey: true // ĐẶT thành TRUE để ép buộc lưu tên
      },
      timeout: 60000,
      attestation: 'direct' // Thay đổi từ 'none' sang 'direct' để có thêm thông tin
    };

    console.log("Đang yêu cầu tạo credential với options:", options);
    
    const credential = await navigator.credentials.create({
      publicKey: options
    }) as PublicKeyCredential;

    if (!credential) {
      throw new Error('Không thể tạo khóa WebAuthn');
    }

    console.log("Credential đã được tạo:", credential);
    
    const response = credential.response as AuthenticatorAttestationResponse;
    
    // Phân tích attestationObject để lấy public key
    const attestationBuffer = new Uint8Array(response.attestationObject);
    const attestationObject = CBOR.decode(attestationBuffer.buffer);
    
    // Lấy thông tin credentialId
    const credentialId = bufferToHex(credential.rawId);
    console.log("Raw credential ID buffer:", new Uint8Array(credential.rawId));
    console.log("Credentials raw ID as hex:", credentialId);
    
    // Phân tích authenticatorData để lấy public key
    const authData = attestationObject.authData;
    const publicKeyBytes = extractPublicKeyFromAuthData(authData);
    const publicKey = bufferToHex(publicKeyBytes);
    
    // Lưu thông tin credential vào indexedDB/localStorage để sử dụng sau này
    saveCredentialInfo(walletAddress, credentialId, publicKey, userId, walletDisplayName);
    
    return {
      credentialId,
      publicKey,
      rawId: new Uint8Array(credential.rawId)
    };
  } catch (error) {
    console.error('Lỗi khi tạo WebAuthn credential:', error);
    throw error;
  }
};

/**
 * Trích xuất public key từ authenticator data
 */
function extractPublicKeyFromAuthData(authData: Uint8Array): Uint8Array {
  // Theo WebAuthn spec, bố cục của authenticator data:
  // [32 bytes RP ID hash, 1 byte flags, 4 bytes counter, variable length AAGUID, variable length credential ID, variable length COSE public key]
  
  // Bỏ qua 32 bytes cho RP ID hash + 1 byte flags + 4 bytes counter = 37 bytes
  let offset = 37;
  
  // Bỏ qua AAGUID (16 bytes)
  offset += 16;
  
  // Đọc độ dài credential ID (2 bytes)
  const credentialIdLength = (authData[offset] << 8) | authData[offset + 1];
  offset += 2;
  
  // Bỏ qua credential ID
  offset += credentialIdLength;
  
  // Đọc COSE public key
  const cosePublicKey = authData.slice(offset);
  
  try {
    // Giải mã COSE public key (sử dụng thư viện CBOR nếu có)
    const publicKeyObj = CBOR.decode(cosePublicKey);
    
    // Lấy coordinaates x và y từ -2 và -3 (theo COSE Web Key)
    const x = publicKeyObj.get(-2);
    const y = publicKeyObj.get(-3);
    
    // Tạo uncompressed EC public key (0x04 || x || y)
    const uncompressedKey = new Uint8Array(65);
    uncompressedKey[0] = 0x04; // Uncompressed point format
    uncompressedKey.set(new Uint8Array(x), 1);
    uncompressedKey.set(new Uint8Array(y), 33);
    
    return uncompressedKey;
  } catch (e) {
    console.error("Lỗi khi trích xuất public key:", e);
    
    // Trả về dummy key nếu không thể trích xuất
    const dummyKey = new Uint8Array(65);
    dummyKey[0] = 0x04;
    const randomX = new Uint8Array(32);
    const randomY = new Uint8Array(32);
    window.crypto.getRandomValues(randomX);
    window.crypto.getRandomValues(randomY);
    dummyKey.set(randomX, 1);
    dummyKey.set(randomY, 33);
    
    return dummyKey;
  }
}

/**
 * Sử dụng WebAuthn credential đã có
 */
export const getWebAuthnCredential = async (
  credentialId: Buffer,
  challenge?: Uint8Array
): Promise<{ 
  signature: Uint8Array; 
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
}> => {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn không được hỗ trợ trên trình duyệt này');
  }

  // Sử dụng challenge được cung cấp hoặc tạo mới nếu không có
  const finalChallenge = challenge || crypto.getRandomValues(new Uint8Array(32));
  
  // Tạo options cho get assertion
  const options: PublicKeyCredentialRequestOptions = {
    challenge: finalChallenge,
    allowCredentials: [{
      id: credentialId,
      type: 'public-key',
    }],
    userVerification: 'preferred',
    timeout: 60000
  };

  try {
    const assertion = await navigator.credentials.get({
      publicKey: options
    }) as PublicKeyCredential;

    const response = assertion.response as AuthenticatorAssertionResponse;
    
    return {
      signature: new Uint8Array(response.signature),
      authenticatorData: new Uint8Array(response.authenticatorData),
      clientDataJSON: new Uint8Array(response.clientDataJSON)
    };
  } catch (error) {
    console.error('Lỗi khi xác thực WebAuthn:', error);
    throw error;
  }
};

/**
 * Kiểm tra xem WebAuthn có được hỗ trợ không
 */
export const isWebAuthnSupported = (): boolean => {
  return window.PublicKeyCredential !== undefined && 
         typeof window.PublicKeyCredential === 'function';
};

// Chạy thử một số tùy chọn để kiểm tra khả năng tương thích
export const checkWebAuthnCompatibility = async (): Promise<string> => {
  if (!isWebAuthnSupported()) {
    return 'WebAuthn không được hỗ trợ trên trình duyệt này';
  }
  
  try {
    // Kiểm tra xem trình duyệt có hỗ trợ thuộc tính "isUserVerifyingPlatformAuthenticatorAvailable"
    if (PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!available) {
        return 'Thiết bị này không có xác thực sinh trắc học được hỗ trợ';
      }
    }
    
    return 'WebAuthn được hỗ trợ đầy đủ';
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Lỗi khi kiểm tra WebAuthn: ${errorMessage}`;
  }
};

/**
 * Xác minh chữ ký WebAuthn trong frontend
 */
export const verifyWebAuthnSignature = async (
  pubkey: Buffer,
  signature: Uint8Array,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array
): Promise<boolean> => {
  try {
    // Kiểm tra các tham số đầu vào
    if (!pubkey || !signature || !authenticatorData || !clientDataJSON) {
      console.error('Thiếu tham số cần thiết cho xác minh WebAuthn');
      return false;
    }
    
    console.log("Public key length:", pubkey.length);
    console.log("Pubkey:", pubkey.toString('hex'));
    
    // Kiểm tra độ dài khóa
    if (pubkey.length !== 65) {
      console.warn(`Khóa WebAuthn không đúng độ dài: ${pubkey.length} (cần 65 byte)`);
      
      // Tạo khóa mới với độ dài đúng
      const newPubkey = Buffer.alloc(65);
      copyBuffer(pubkey, newPubkey, 0, 0, Math.min(pubkey.length, 65));
      
      // Nếu byte đầu tiên không phải 0x04, sửa lại
      if (newPubkey[0] !== 0x04) {
        newPubkey[0] = 0x04;
      }
      
      pubkey = newPubkey;
      console.log('Pubkey sau khi sửa độ dài:', pubkey.toString('hex'));
    }
    
    // Kiểm tra định dạng khóa (phải bắt đầu bằng 0x04)
    if (pubkey[0] !== 0x04) {
      console.warn(`Khóa WebAuthn không bắt đầu bằng 0x04: ${pubkey[0].toString(16)}`);
      // Tạo khóa mới với byte đầu tiên là 0x04
      const newPubkey = Buffer.alloc(65);
      newPubkey[0] = 0x04;
      copyBuffer(pubkey, newPubkey, 1, 1, 65);
      pubkey = newPubkey;
      console.log('Pubkey sau khi sửa byte đầu:', pubkey.toString('hex'));
    }
    
    // 1. Parse clientDataJSON
    const clientDataObj = JSON.parse(new TextDecoder().decode(clientDataJSON));
    console.log("Client data:", clientDataObj);
    
    // 2. Lấy hash của clientDataJSON
    const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
    
    // 3. Kết hợp dữ liệu để xác minh
    const authData = new Uint8Array(authenticatorData);
    const hashData = new Uint8Array(clientDataHash);
    const verificationData = new Uint8Array(authData.length + hashData.length);
    verificationData.set(authData, 0);
    verificationData.set(hashData, authData.length);
    
    console.log("Dữ liệu xác minh:", Buffer.from(verificationData).toString('hex'));
    console.log("Pubkey cuối cùng:", pubkey.toString('hex'));
    console.log("Signature:", Buffer.from(signature).toString('hex'));
    console.log("Signature length:", signature.length);
    
    try {
      // 4. Chuyển đổi khóa công khai sang định dạng SPKI
      const spkiKey = convertRawToSPKI(pubkey);
      
      // 5. Import khóa công khai
      const cryptoKey = await crypto.subtle.importKey(
        'spki',
        spkiKey,
        {
          name: 'ECDSA',
          namedCurve: 'P-256'
        },
        false,
        ['verify']
      );
      
      // 6. Xác minh chữ ký
      const result = await crypto.subtle.verify(
        {
          name: 'ECDSA',
          hash: 'SHA-256'
        },
        cryptoKey,
        signature,
        verificationData
      );
      
      console.log('Kết quả xác minh:', result);
      return result;
    } catch (e) {
      console.error("Lỗi khi xác thực chữ ký:", e);
      
      // Thử với cách khác nếu cách đầu tiên thất bại
      try {
        console.log('Thử phương pháp xác minh thay thế...');
        
        // Chuyển đổi chữ ký từ DER sang raw nếu cần
        let rawSignature = signature;
        if (signature.length > 64 && signature[0] === 0x30) {
          console.log('Phát hiện chữ ký DER, đang chuyển đổi...');
          const derSignature = Buffer.from(signature);
          const convertedSignature = derToRaw(derSignature);
          rawSignature = convertedSignature;
          console.log('Chữ ký sau khi chuyển đổi:', Buffer.from(rawSignature).toString('hex'));
        }
        
        // Import khóa và xác minh lại
        const spkiKey = convertRawToSPKI(pubkey);
        const cryptoKey = await crypto.subtle.importKey(
          'spki',
          spkiKey,
          {
            name: 'ECDSA',
            namedCurve: 'P-256'
          },
          false,
          ['verify']
        );
        
        const result = await crypto.subtle.verify(
          {
            name: 'ECDSA',
            hash: 'SHA-256'
          },
          cryptoKey,
          rawSignature,
          verificationData
        );
        
        console.log('Kết quả xác minh thay thế:', result);
        return result;
      } catch (alternativeError) {
        console.error('Lỗi khi thử phương pháp thay thế:', alternativeError);
        return false;
      }
    }
  } catch (error) {
    console.error('Lỗi khi xác minh chữ ký WebAuthn:', error);
    return false;
  }
};



// Sửa lại hàm copy để tránh lỗi về type
function copyBuffer(source: Buffer, target: Buffer, targetStart = 0, sourceStart = 0, sourceEnd = source.length): void {
  // Tạo view mới từ source buffer
  const sourceView = new Uint8Array(source.buffer, source.byteOffset + sourceStart, Math.min(sourceEnd, source.length) - sourceStart);
  // Tạo view mới từ target buffer
  const targetView = new Uint8Array(target.buffer, target.byteOffset + targetStart, target.length - targetStart);
  // Copy giữa các Uint8Array
  targetView.set(sourceView.slice(0, Math.min(sourceView.length, targetView.length)));
}

// Hàm chuyển đổi khóa từ định dạng raw sang SPKI
const convertRawToSPKI = (rawKey: Buffer): ArrayBuffer => {
  try {
    // Đảm bảo khóa bắt đầu bằng 0x04
    if (rawKey[0] !== 0x04) {
      console.warn('Khóa không bắt đầu bằng 0x04, đang sửa...');
      // Tạo khóa mới với byte đầu tiên là 0x04
      const newRawKey = Buffer.alloc(65);
      newRawKey[0] = 0x04;
      // Sao chép phần còn lại của khóa
      if (rawKey.length >= 64) {
        copyBuffer(rawKey, newRawKey, 1, 1, 65);
      } else {
        copyBuffer(rawKey, newRawKey, 1, 0, Math.min(rawKey.length, 64));
      }
      rawKey = newRawKey;
    }
    
    // Tạo SPKI header
    const spkiHeader = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
    
    // Nối header với khóa (bỏ byte đầu tiên 0x04)
    const rawKeySlice = new Uint8Array(rawKey.buffer, rawKey.byteOffset + 1, rawKey.length - 1);
    const spkiBuffer = new Uint8Array(spkiHeader.length + rawKeySlice.length);
    spkiBuffer.set(new Uint8Array(spkiHeader), 0);
    spkiBuffer.set(rawKeySlice, spkiHeader.length);
    
    // Trả về ArrayBuffer
    return spkiBuffer.buffer.slice(0); // .slice(0) đảm bảo trả về ArrayBuffer thay vì ArrayBufferLike
  } catch (error) {
    console.error('Lỗi khi chuyển đổi khóa:', error);
    throw error;
  }
};

// Hàm chuyển đổi chữ ký từ DER sang raw
const derToRaw = (signature: Buffer): Uint8Array => {
  try {
    console.log('Chuyển đổi chữ ký DER sang raw format...');
    console.log('DER signature length:', signature.length);
    console.log('DER signature (hex):', signature.toString('hex'));
    
    // Kiểm tra format DER
    if (signature[0] !== 0x30) {
      throw new Error('Chữ ký không đúng định dạng DER: byte đầu tiên không phải 0x30');
    }
    
    // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
    let offset = 2; // Skip 0x30 + len
    
    // Đọc r
    if (signature[offset] !== 0x02) {
      throw new Error('Định dạng DER không hợp lệ: không tìm thấy marker r (0x02)');
    }
    offset++; // Skip 0x02
    
    const rLen = signature[offset++];
    let r = signature.slice(offset, offset + rLen);
    offset += rLen;
    
    // Đọc s
    if (signature[offset] !== 0x02) {
      throw new Error('Định dạng DER không hợp lệ: không tìm thấy marker s (0x02)');
    }
    offset++; // Skip 0x02
    
    const sLen = signature[offset++];
    let s = signature.slice(offset, offset + sLen);
    
    console.log('Đã trích xuất r và s từ DER:');
    console.log('r length:', r.length, 'r (hex):', r.toString('hex'));
    console.log('s length:', s.length, 's (hex):', s.toString('hex'));
    
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
      rPadded.set(new Uint8Array(r), 32 - r.length);
    } else {
      // Trường hợp r dài hơn 32 bytes, lấy 32 bytes cuối
      rPadded.set(new Uint8Array(r.slice(r.length - 32)));
    }
    
    if (s.length <= 32) {
      // Trường hợp s ngắn hơn 32 bytes, thêm padding
      sPadded.set(new Uint8Array(s), 32 - s.length);
    } else {
      // Trường hợp s dài hơn 32 bytes, lấy 32 bytes cuối
      sPadded.set(new Uint8Array(s.slice(s.length - 32)));
    }
    
    // Nối r và s lại
    const rawSignature = new Uint8Array(64);
    rawSignature.set(rPadded, 0);
    rawSignature.set(sPadded, 32);
    
    console.log('Raw signature sau khi chuyển đổi (r||s):');
    console.log('- Length:', rawSignature.length);
    console.log('- Hex:', Buffer.from(rawSignature).toString('hex'));
    
    return rawSignature;
  } catch (error) {
    console.error('Lỗi khi chuyển đổi chữ ký DER sang raw:', error);
    throw error;
  }
};

/**
 * Kiểm tra xem public key có đúng định dạng không
 */
export const validatePublicKey = (publicKeyHex: string): boolean => {
  try {
    const pubkey = Buffer.from(publicKeyHex, 'hex');
    // Public key không nén phải là 65 bytes (1 byte header + 32 bytes x + 32 bytes y)
    if (pubkey.length !== 65) {
      console.error(`Public key không đúng độ dài: ${pubkey.length} bytes (mong đợi 65 bytes)`);
      return false;
    }
    
    // Byte đầu tiên phải là 0x04 (định dạng không nén)
    if (pubkey[0] !== 0x04) {
      console.error(`Public key không phải định dạng không nén: byte đầu tiên là ${pubkey[0].toString(16)} (mong đợi 0x04)`);
      return false;
    }
    
    console.log("Public key hợp lệ");
    return true;
  } catch (error) {
    console.error("Lỗi khi xác thực public key:", error);
    return false;
  }
};

/**
 * Lấy WebAuthn assertion từ credential đã có
 */
export const getWebAuthnAssertion = async (credentialId: string | null, message?: string, allowEmpty: boolean = false): Promise<{ 
  signature: Uint8Array; 
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
}> => {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn không được hỗ trợ trên trình duyệt này');
  }

  console.log("Bắt đầu xác thực WebAuthn để ký tin nhắn");

  // Tạo challenge từ message hoặc ngẫu nhiên nếu không có message
  let challenge: Uint8Array;
  if (message) {
    // QUAN TRỌNG: KHÔNG hash message ở đây
    // WebAuthn sẽ tự động hash message với SHA-256
    // Gửi message gốc trực tiếp làm challenge
    challenge = new TextEncoder().encode(message);
    console.log("Sử dụng message gốc làm challenge:", message);
    console.log("Challenge bytes:", Array.from(challenge).map(b => b.toString(16).padStart(2, '0')).join(' '));
  } else {
    // Nếu không, tạo challenge ngẫu nhiên
    challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    console.log("Sử dụng challenge ngẫu nhiên");
  }
  
  // Tạo options cho get assertion
  const options: PublicKeyCredentialRequestOptions = {
    challenge: challenge,
    timeout: 60000,
    userVerification: 'discouraged' // Thay đổi 'required' thành 'discouraged' để không bắt buộc xác thực sinh trắc học
  };

  // Nếu có credentialId cụ thể và không cho phép empty, đặt allowCredentials 
  if (credentialId && !allowEmpty) {
    try {
      // Chuyển đổi từ hex sang buffer
      const credentialIdBuffer = Buffer.from(credentialId, 'hex');
      options.allowCredentials = [{
        id: credentialIdBuffer,
        type: 'public-key',
        transports: ['internal', 'hybrid', 'usb', 'ble', 'nfc']
      }];
      console.log("Sử dụng credential cụ thể:", credentialId);
    } catch (error) {
      console.error("Lỗi khi parse credentialId:", error);
    }
  } else {
    // Không chỉ định allowCredentials để hiển thị tất cả các credentials có sẵn
    console.log("Hiển thị danh sách tất cả các credentials để người dùng chọn");
  }

  try {
    console.log("Đang yêu cầu xác thực WebAuthn...");
    
    const assertion = await navigator.credentials.get({
      publicKey: options
    }) as PublicKeyCredential;
    
    if (!assertion) {
      throw new Error("Không nhận được kết quả xác thực từ WebAuthn");
    }
    
    const response = assertion.response as AuthenticatorAssertionResponse;
    
    // Log thông tin để debug
    console.log("WebAuthn assertion thành công:");
    console.log("- Signature length:", response.signature.byteLength);
    console.log("- ClientDataJSON:", new TextDecoder().decode(response.clientDataJSON));
    
    return {
      signature: new Uint8Array(response.signature),
      authenticatorData: new Uint8Array(response.authenticatorData),
      clientDataJSON: new Uint8Array(response.clientDataJSON)
    };
  } catch (error) {
    console.error('Lỗi khi xác thực WebAuthn:', error);
    throw error;
  }
};

/**
 * Lưu thông tin credential vào localStorage
 */
function saveCredentialInfo(
  walletAddress: string,
  credentialId: string,
  publicKey: string,
  userId: Uint8Array,
  displayName: string
): void {
  try {
    // Chuẩn bị thông tin credential để lưu
    const credentialInfo = {
      walletAddress,
      credentialId,
      publicKey,
      userId: Array.from(userId), // Chuyển Uint8Array thành Array để có thể serialize
      displayName,
      createdAt: new Date().toISOString()
    };
    
    // Lưu vào danh sách credentials
    let credentialsList = [];
    try {
      const credentialsListStr = localStorage.getItem('webauthnCredentials');
      if (credentialsListStr) {
        credentialsList = JSON.parse(credentialsListStr);
      }
    } catch (storageError) {
      console.warn("Không thể đọc credentials từ localStorage:", storageError);
      // Tiếp tục với mảng rỗng
    }
    
    // Thêm credential mới vào danh sách
    credentialsList.push(credentialInfo);
    
    try {
      localStorage.setItem('webauthnCredentials', JSON.stringify(credentialsList));
      console.log("Đã lưu thông tin credential mới:", credentialInfo);
    } catch (saveError) {
      console.error("Không thể lưu credentials vào localStorage:", saveError);
      // Không ngăn luồng hoạt động ngay cả khi không thể lưu
    }
  } catch (error) {
    console.error("Lỗi khi xử lý thông tin credential:", error);
  }
};

/**
 * Xác thực để đăng nhập bằng WebAuthn với credential ID đã biết
 */
export const getWebAuthnAssertionForLogin = async (
  credentialIdBase64: string,
  allowEmpty: boolean = false
): Promise<{
  success: boolean;
  rawId?: Uint8Array;
  error?: string;
}> => {
  try {
    if (!isWebAuthnSupported()) {
      throw new Error('WebAuthn không được hỗ trợ trên trình duyệt này');
    }

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    // Tạo options cho get assertion
    const options: PublicKeyCredentialRequestOptions = {
      challenge: challenge,
      timeout: 60000,
      userVerification: 'preferred',
    };

    // Nếu có credential ID, thêm vào allowCredentials
    if (credentialIdBase64) {
      const credentialIdBuffer = new Uint8Array(Buffer.from(credentialIdBase64, 'base64'));
      console.log("Đang đăng nhập với credential ID:", credentialIdBase64);
      options.allowCredentials = [{
        id: credentialIdBuffer,
        type: 'public-key',
      }];
    } else if (!allowEmpty) {
      throw new Error('Credential ID không được cung cấp');
    }

    // Nếu không có credential ID và allowEmpty = true, 
    // có thể trình duyệt sẽ hiển thị tất cả credentials có sẵn

    console.log("Đang yêu cầu xác thực WebAuthn với options:", options);
    
    const assertion = await navigator.credentials.get({
      publicKey: options
    }) as PublicKeyCredential;

    if (!assertion) {
      throw new Error('Không thể lấy thông tin xác thực WebAuthn');
    }

    console.log("Xác thực WebAuthn thành công:", assertion);
    
    return {
      success: true,
      rawId: new Uint8Array(assertion.rawId)
    };
  } catch (error: any) {
    console.error('Lỗi khi xác thực WebAuthn:', error);
    return {
      success: false,
      error: error.message || 'Không thể xác thực'
    };
  }
};

/**
 * Lấy thông tin Multisig PDA dựa trên credential ID
 */
export const calculateMultisigAddress = (
  programId: PublicKey, 
  credentialId: string
): [PublicKey, number] => {
  // Sử dụng hàm processCredentialIdForPDA từ helpers.ts để đảm bảo tính nhất quán
  const seedBuffer = processCredentialIdForPDA(credentialId);
  
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("multisig"),
      seedBuffer
    ],
    programId
  );
};

/**
 * Tạo verification data từ WebAuthn assertion
 * @param assertion - WebAuthn assertion
 * @returns Uint8Array chứa dữ liệu verification (authenticatorData + hash(clientDataJSON))
 */
export const createWebAuthnVerificationData = async (
  assertion: {
    signature: Uint8Array;
    authenticatorData: Uint8Array;
    clientDataJSON: Uint8Array;
  }
): Promise<Uint8Array> => {
  // 1. Tính hash của clientDataJSON
  const clientDataHash = await crypto.subtle.digest('SHA-256', assertion.clientDataJSON);
  const clientDataHashBytes = new Uint8Array(clientDataHash);
  
  // 2. Tạo verification data: authenticatorData + hash(clientDataJSON)
  const verificationData = new Uint8Array(assertion.authenticatorData.length + clientDataHashBytes.length);
  verificationData.set(new Uint8Array(assertion.authenticatorData), 0);
  verificationData.set(clientDataHashBytes, assertion.authenticatorData.length);
  
  return verificationData;
};