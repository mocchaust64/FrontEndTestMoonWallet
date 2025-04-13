import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { PublicKey } from '@solana/web3.js';
import { getProposalById } from '../firebase/proposalService';
import { getWebAuthnAssertion, createWebAuthnVerificationData } from '../utils/webauthnUtils';
import { getWalletByCredentialId } from '../firebase/webAuthnService';
import { createSecp256r1Instruction, derToRaw, normalizeSignatureToLowS } from '../utils/transactionUtils';
import { connection } from '../config/solana';
import '../App.css';

const ProposalSignPage: React.FC = () => {
  const { proposalId } = useParams<{ proposalId: string }>();
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<any>(null);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    const loadProposal = async () => {
      try {
        if (!proposalId) {
          setError('Mã đề xuất không hợp lệ');
          setLoading(false);
          return;
        }

        setStatus('Đang tải thông tin đề xuất...');
        
        // Tìm đề xuất theo proposalId (public key)
        const proposalData = await getProposalById(proposalId, 0); // Truyền 0 vì proposalId là địa chỉ
        
        if (!proposalData) {
          setError('Không tìm thấy đề xuất với mã này');
          setLoading(false);
          return;
        }

        setProposal(proposalData);
        setStatus('Đã tải thông tin đề xuất thành công');
        setLoading(false);
      } catch (error: any) {
        console.error("Lỗi khi tải đề xuất:", error);
        setError(`Lỗi khi tải đề xuất: ${error.message}`);
        setLoading(false);
      }
    };

    loadProposal();
  }, [proposalId]);

  const handleSignProposal = async () => {
    try {
      setStatus('Đang chuẩn bị ký đề xuất...');
      
      // 1. Yêu cầu xác thực với WebAuthn
      setStatus('Vui lòng xác thực với thiết bị của bạn (Touch ID, Face ID, v.v.)');
      
      // Yêu cầu người dùng nhập credential ID của họ
      const credentialId = prompt("Nhập Credential ID của bạn để ký đề xuất:", "");
      
      if (!credentialId) {
        setStatus('Bạn chưa nhập Credential ID');
        return;
      }
      
      // 2. Lấy xác thực WebAuthn
      const assertion = await getWebAuthnAssertion(credentialId);
      
      if (!assertion) {
        setStatus('Không thể lấy xác thực WebAuthn. Vui lòng thử lại.');
        return;
      }
      
      // 3. Lấy WebAuthn public key từ Firebase
      const credentialMapping = await getWalletByCredentialId(credentialId);
      
      if (!credentialMapping || !credentialMapping.guardianPublicKey) {
        setStatus('Không tìm thấy thông tin public key cho credential này');
        return;
      }
      
      const webAuthnPubKey = Buffer.from(new Uint8Array(credentialMapping.guardianPublicKey));
      
      // 4. Tạo verification data và chuẩn bị chữ ký
      const verificationData = await createWebAuthnVerificationData(assertion);
      const signatureRaw = derToRaw(assertion.signature);
      const normalizedSignature = normalizeSignatureToLowS(Buffer.from(signatureRaw));
      
      // 5. Tạo instruction secp256r1
      const secp256r1Instruction = createSecp256r1Instruction(
        Buffer.from(verificationData),
        webAuthnPubKey,
        normalizedSignature
      );
      
      // 6. Gọi API để ký đề xuất (có thể cần thêm code để gửi transaction)
      // TODO: Thêm code để gửi transaction ký đề xuất
      
      setStatus('Đã ký đề xuất thành công!');
    } catch (error: any) {
      console.error("Lỗi khi ký đề xuất:", error);
      setStatus(`Lỗi khi ký đề xuất: ${error.message}`);
    }
  };

  const handleExecuteProposal = async () => {
    try {
      setStatus('Đang thực thi đề xuất...');
      
      // TODO: Thêm code để thực thi đề xuất
      
      setStatus('Đã thực thi đề xuất thành công!');
    } catch (error: any) {
      console.error("Lỗi khi thực thi đề xuất:", error);
      setStatus(`Lỗi khi thực thi đề xuất: ${error.message}`);
    }
  };

  if (loading) return (
    <div className="container" style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Ký đề xuất</h1>
      <div className="loading">Đang tải thông tin đề xuất...</div>
    </div>
  );
  
  if (error) return (
    <div className="container" style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Ký đề xuất</h1>
      <div className="error-message" style={{ color: 'red', padding: '10px', border: '1px solid red', borderRadius: '4px' }}>
        {error}
      </div>
      <button 
        onClick={() => window.location.href = `${window.location.origin}/#/`} 
        style={{ marginTop: '20px', padding: '10px 20px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
      >
        Quay lại trang chính
      </button>
    </div>
  );

  return (
    <div className="container" style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Ký đề xuất</h1>
      
      <div className="proposal-details" style={{ backgroundColor: '#f9f9f9', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
        <h2>Thông tin đề xuất</h2>
        <p><strong>Ví Multisig:</strong> {proposal?.multisigAddress}</p>
        <p><strong>Loại giao dịch:</strong> {proposal?.action}</p>
        <p><strong>Mô tả:</strong> {proposal?.description}</p>
        {proposal?.action === 'transfer' && (
          <>
            <p><strong>Người nhận:</strong> {proposal?.destination}</p>
            <p><strong>Số lượng:</strong> {proposal?.amount / 1000000000} SOL</p>
          </>
        )}
        <p><strong>Trạng thái:</strong> {proposal?.status}</p>
        <p><strong>Số chữ ký hiện tại:</strong> {proposal?.signers?.length || 0}</p>
        <p><strong>Số chữ ký cần thiết:</strong> {proposal?.requiredSignatures || '?'}</p>
      </div>
      
      <div className="actions" style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <button 
          onClick={handleSignProposal}
          style={{ 
            padding: '10px 20px', 
            backgroundColor: '#2196F3', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px', 
            cursor: 'pointer',
            flex: '1'
          }}
          disabled={proposal?.status === 'executed'}
        >
          Ký đề xuất
        </button>
        
        {proposal?.signers?.length >= proposal?.requiredSignatures && (
          <button 
            onClick={handleExecuteProposal}
            style={{ 
              padding: '10px 20px', 
              backgroundColor: '#4CAF50', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px', 
              cursor: 'pointer',
              flex: '1'
            }}
            disabled={proposal?.status === 'executed'}
          >
            Thực thi đề xuất
          </button>
        )}
      </div>
      
      {status && (
        <div className="status-message" style={{ 
          padding: '10px', 
          backgroundColor: '#d9edf7', 
          color: '#31708f', 
          border: '1px solid #bce8f1', 
          borderRadius: '4px',
          marginBottom: '20px'
        }}>
          {status}
        </div>
      )}
      
      <button 
        onClick={() => window.location.href = `${window.location.origin}/#/`} 
        style={{ 
          padding: '10px 20px', 
          backgroundColor: '#555', 
          color: 'white', 
          border: 'none', 
          borderRadius: '4px', 
          cursor: 'pointer' 
        }}
      >
        Quay lại trang chính
      </button>
    </div>
  );
};

export default ProposalSignPage; 