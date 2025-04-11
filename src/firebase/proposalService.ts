import { 
  collection, query, where, orderBy, getDocs, 
  addDoc, updateDoc, doc, getDoc, serverTimestamp,
  Timestamp
} from "firebase/firestore";
import { PublicKey } from "@solana/web3.js";
import { db } from "./config";

// Định nghĩa kiểu dữ liệu đề xuất
export interface Proposal {
  id: number;
  proposalId: number;
  multisigAddress: string;
  description: string;
  action: string;
  status: string;
  createdAt: any;
  creator: string;
  signers: string[];
  requiredSignatures: number;
  destination?: string;
  amount?: number;
  tokenMint?: string | null;
  transactionSignature?: string;
}

/**
 * Lấy tất cả đề xuất của một địa chỉ ví multisig
 * @param multisigAddress Địa chỉ ví đa chữ ký
 * @returns Danh sách đề xuất đã sắp xếp
 */
export const getProposalsByWallet = async (multisigAddress: PublicKey): Promise<Proposal[]> => {
  try {
    console.log("Đang tải danh sách đề xuất từ Firebase...");
    console.log("Multisig PDA:", multisigAddress.toString());
    
    // Phương pháp 1: Thử truy vấn với where nhưng không orderBy
    try {
      const q = query(
        collection(db, 'proposals'),
        where('multisigAddress', '==', multisigAddress.toString())
        // Không dùng orderBy để tránh yêu cầu index
      );
      
      const querySnapshot = await getDocs(q);
      console.log(`Tìm thấy ${querySnapshot.size} đề xuất trên Firebase`);
      
      const fetchedProposals: Proposal[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        fetchedProposals.push({
          id: doc.id ? parseInt(doc.id) : 0,
          proposalId: data.proposalId,
          multisigAddress: data.multisigAddress,
          description: data.description,
          action: data.action,
          status: data.status,
          createdAt: data.createdAt,
          creator: data.creator,
          signers: data.signers || [],
          requiredSignatures: data.requiredSignatures,
          destination: data.destination,
          amount: data.amount,
          tokenMint: data.tokenMint,
          transactionSignature: data.transactionSignature
        });
      });
      
      // Sắp xếp thủ công thay vì dùng orderBy trong query
      fetchedProposals.sort((a, b) => {
        const dateA = a.createdAt?.toDate?.() || new Date(0);
        const dateB = b.createdAt?.toDate?.() || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });
      
      console.log("Đã tải các đề xuất từ Firebase:", fetchedProposals);
      return fetchedProposals;
      
    } catch (queryError) {
      console.error("Lỗi khi truy vấn Firebase với where, thử phương pháp khác:", queryError);
      
      // Phương pháp 2: Lấy tất cả proposal và lọc trong code
      const allProposalsSnapshot = await getDocs(collection(db, 'proposals'));
      const allProposals: Proposal[] = [];
      
      allProposalsSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.multisigAddress === multisigAddress.toString()) {
          allProposals.push({
            id: doc.id ? parseInt(doc.id) : 0,
            proposalId: data.proposalId,
            multisigAddress: data.multisigAddress,
            description: data.description,
            action: data.action,
            status: data.status,
            createdAt: data.createdAt,
            creator: data.creator,
            signers: data.signers || [],
            requiredSignatures: data.requiredSignatures,
            destination: data.destination,
            amount: data.amount,
            tokenMint: data.tokenMint,
            transactionSignature: data.transactionSignature
          });
        }
      });
      
      // Sắp xếp thủ công
      allProposals.sort((a, b) => {
        const dateA = a.createdAt?.toDate?.() || new Date(0);
        const dateB = b.createdAt?.toDate?.() || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });
      
      console.log("Đã tải các đề xuất bằng phương pháp 2:", allProposals);
      return allProposals;
    }
    
  } catch (error) {
    console.error("Lỗi khi tải đề xuất từ Firebase:", error);
    return [];
  }
};

/**
 * Lấy đề xuất theo ID
 * @param multisigAddress Địa chỉ ví
 * @param proposalId ID của đề xuất
 * @returns Thông tin chi tiết đề xuất
 */
export const getProposalById = async (multisigAddress: string, proposalId: number): Promise<Proposal | null> => {
  try {
    const q = query(
      collection(db, 'proposals'),
      where('multisigAddress', '==', multisigAddress),
      where('proposalId', '==', proposalId)
    );
    
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
      console.log(`Không tìm thấy đề xuất với ID ${proposalId}`);
      return null;
    }
    
    const docData = querySnapshot.docs[0].data();
    return {
      id: querySnapshot.docs[0].id ? parseInt(querySnapshot.docs[0].id) : 0,
      proposalId: docData.proposalId,
      multisigAddress: docData.multisigAddress,
      description: docData.description,
      action: docData.action,
      status: docData.status,
      createdAt: docData.createdAt,
      creator: docData.creator,
      signers: docData.signers || [],
      requiredSignatures: docData.requiredSignatures,
      destination: docData.destination,
      amount: docData.amount,
      tokenMint: docData.tokenMint,
      transactionSignature: docData.transactionSignature
    };
  } catch (error) {
    console.error(`Lỗi khi lấy đề xuất ID ${proposalId}:`, error);
    return null;
  }
};

/**
 * Tạo đề xuất mới
 * @param proposalData Dữ liệu đề xuất
 * @returns ID của đề xuất
 */
export const createProposal = async (proposalData: Omit<Proposal, 'id' | 'createdAt'>): Promise<string> => {
  try {
    const docRef = await addDoc(collection(db, 'proposals'), {
      ...proposalData,
      createdAt: serverTimestamp()
    });
    
    console.log(`Đã tạo đề xuất mới với ID: ${docRef.id}`);
    return docRef.id;
  } catch (error) {
    console.error("Lỗi khi tạo đề xuất:", error);
    throw error;
  }
};

/**
 * Cập nhật trạng thái đề xuất
 * @param multisigAddress Địa chỉ ví
 * @param proposalId ID của đề xuất
 * @param newStatus Trạng thái mới
 * @param transactionSignature Chữ ký giao dịch (nếu có)
 */
export const updateProposalStatus = async (
  multisigAddress: string,
  proposalId: number,
  newStatus: string,
  transactionSignature?: string
): Promise<void> => {
  try {
    const q = query(
      collection(db, 'proposals'),
      where('multisigAddress', '==', multisigAddress),
      where('proposalId', '==', proposalId)
    );
    
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
      throw new Error(`Không tìm thấy đề xuất với ID ${proposalId}`);
    }
    
    const docRef = doc(db, 'proposals', querySnapshot.docs[0].id);
    const updateData: any = { status: newStatus };
    
    if (transactionSignature) {
      updateData.transactionSignature = transactionSignature;
    }
    
    await updateDoc(docRef, updateData);
    console.log(`Đã cập nhật trạng thái đề xuất ${proposalId} thành ${newStatus}`);
  } catch (error) {
    console.error(`Lỗi khi cập nhật trạng thái đề xuất ${proposalId}:`, error);
    throw error;
  }
};

/**
 * Thêm người ký mới vào đề xuất
 * @param multisigAddress Địa chỉ ví
 * @param proposalId ID của đề xuất
 * @param signerPublicKey Public key của người ký (có thể là WebAuthn publicKey hoặc địa chỉ Solana)
 */
export const addSignerToProposal = async (
  multisigAddress: string,
  proposalId: number,
  signerPublicKey: string
): Promise<void> => {
  try {
    const q = query(
      collection(db, 'proposals'),
      where('multisigAddress', '==', multisigAddress),
      where('proposalId', '==', proposalId)
    );
    
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
      throw new Error(`Không tìm thấy đề xuất với ID ${proposalId}`);
    }
    
    const docRef = doc(db, 'proposals', querySnapshot.docs[0].id);
    const docData = querySnapshot.docs[0].data();
    const existingSigners = docData.signers || [];
    
    // Kiểm tra xem đã ký chưa
    if (existingSigners.includes(signerPublicKey)) {
      console.log(`Public key ${signerPublicKey} đã ký đề xuất này trước đó`);
      return;
    }
    
    // Thêm chữ ký mới
    const newSigners = [...existingSigners, signerPublicKey];
    await updateDoc(docRef, { signers: newSigners });
    
    console.log(`Đã thêm ${signerPublicKey} vào danh sách người ký của đề xuất ${proposalId}`);
  } catch (error) {
    console.error(`Lỗi khi thêm chữ ký vào đề xuất ${proposalId}:`, error);
    throw error;
  }
}; 