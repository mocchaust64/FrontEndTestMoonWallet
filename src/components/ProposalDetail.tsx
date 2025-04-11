import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY
} from '@solana/web3.js';
import { 
  Box, 
  Button, 
  Card, 
  CardContent, 
  Chip, 
  CircularProgress, 
  Container, 
  Divider, 
  Paper, 
  Stack, 
  Typography,
  Alert,
  Tooltip,
  Avatar,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import { useProgram, useMultisigState } from '../contexts/ProgramContext';
import { getWebAuthnCredential, getWebAuthnAssertion } from '../utils/webauthnUtils';
import { formatLamportsToSOL, formatTimestamp, shortenAddress } from '../utils/uiHelpers';
import { createApproveProposalTx, createExecuteProposalTx } from '../utils/transactionUtils';
import { getWalletByCredentialId } from '../firebase/webAuthnService';

// Component hiển thị một người ký với trạng thái
const SignerItem: React.FC<{
  signer: string;
  isCurrent: boolean;
  hasSigned: boolean;
}> = ({ signer, isCurrent, hasSigned }) => {
  return (
    <Box sx={{ 
      display: 'flex', 
      alignItems: 'center', 
      mb: 1,
      p: 1,
      borderRadius: 1,
      bgcolor: isCurrent ? 'primary.light' : 'transparent',
    }}>
      <Avatar 
        sx={{ 
          width: 32, 
          height: 32, 
          bgcolor: hasSigned ? 'success.main' : 'grey.400',
          fontSize: '0.8rem'
        }}
      >
        {hasSigned ? <CheckCircleIcon fontSize="small" /> : signer.substring(0, 2)}
      </Avatar>
      <Box sx={{ ml: 1 }}>
        <Typography variant="body2" sx={{ 
          fontWeight: isCurrent ? 'bold' : 'regular',
          display: 'flex',
          alignItems: 'center'
        }}>
          {shortenAddress(signer)}
          {isCurrent && (
            <Chip 
              label="Bạn" 
              size="small" 
              color="primary" 
              sx={{ ml: 1, height: 20, fontSize: '0.6rem' }} 
            />
          )}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {hasSigned ? 'Đã ký' : 'Chưa ký'}
        </Typography>
      </Box>
    </Box>
  );
};

const ProposalDetail: React.FC = () => {
  const { proposalId } = useParams<{ proposalId: string }>();
  const navigate = useNavigate();
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { program } = useProgram();
  const { multisigPDA, guardianPDA, loading: multisigLoading } = useMultisigState();
  
  const [loading, setLoading] = useState<boolean>(true);
  const [signingLoading, setSigningLoading] = useState<boolean>(false);
  const [executingLoading, setExecutingLoading] = useState<boolean>(false);
  const [proposal, setProposal] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [action, setAction] = useState<'sign' | 'execute' | null>(null);
  
  // Các hàm helper
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Thêm thông báo nếu cần
  };
  
  // Lấy thông tin chi tiết đề xuất
  useEffect(() => {
    const fetchProposalDetails = async () => {
      if (!program || !multisigPDA || !publicKey || !proposalId) {
        return;
      }
      
      try {
        setLoading(true);
        
        // Gọi API để lấy chi tiết đề xuất
        // Đây là giả lập, thay bằng code thực khi có API
        const mockProposal = {
          id: parseInt(proposalId),
          proposalType: 'transfer',
          status: 'pending',
          timestamp: Date.now() - 3600000, // 1 giờ trước
          creator: publicKey.toBase58(),
          signers: [publicKey.toBase58()],
          requiredSignatures: 2,
          destination: 'GH7UD54ZVbvVVuGMHvAh7ALDzwGyiCGzxzLhcBmYmXyR',
          amount: 0.1 * 1e9, // 0.1 SOL in lamports
          tokenMint: null,
          description: 'Chuyển SOL',
          executed: false,
          accountData: {
            proposalPDA: 'Khe19niRtR2AjP6Xhp4wQv52kcnQXdKH5TXcdcfLucr',
            nonce: 1,
            guardians: ['Fy7WiqBy6MuWfnVjiPE8HQqkeLnyaLwBsk8cyyJ5WD8X', publicKey.toBase58()]
          }
        };
        
        setProposal(mockProposal);
        setLoading(false);
      } catch (error) {
        console.error('Lỗi khi lấy chi tiết đề xuất:', error);
        setError('Không thể tải chi tiết đề xuất. Vui lòng thử lại sau.');
        setLoading(false);
      }
    };
    
    fetchProposalDetails();
  }, [program, multisigPDA, publicKey, proposalId]);
  
  // Kiểm tra nếu người dùng hiện tại đã ký
  const hasCurrentUserSigned = () => {
    if (!publicKey || !proposal) return false;
    return proposal.signers.includes(publicKey.toBase58());
  };
  
  // Kiểm tra nếu đủ chữ ký để thực thi
  const hasEnoughSignatures = () => {
    if (!proposal) return false;
    return proposal.signers.length >= proposal.requiredSignatures;
  };
  
  // Hiển thị chip trạng thái với màu phù hợp
  const renderStatusChip = (status: string) => {
    switch (status) {
      case 'pending':
        return <Chip icon={<AccessTimeIcon />} label="Đang chờ" color="warning" size="small" />;
      case 'executed':
        return <Chip icon={<CheckCircleIcon />} label="Đã thực thi" color="success" size="small" />;
      case 'rejected':
        return <Chip icon={<CancelIcon />} label="Đã từ chối" color="error" size="small" />;
      default:
        return <Chip label={status} size="small" />;
    }
  };
  
  // Xử lý ký đề xuất
  const handleSign = async () => {
    if (!publicKey || !program || !multisigPDA || !guardianPDA || !proposal) {
      setError('Không đủ thông tin để ký đề xuất.');
      return;
    }
    
    try {
      setSigningLoading(true);
      setError(null);
      
      // Lấy proposalId từ proposal
      const proposalIdValue = proposal.id;
      
      // Lấy timestamp hiện tại
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Tạo message template để ký - guardianId sẽ được cập nhật sau khi người dùng chọn credential
      const messageTemplate = `approve:proposal_${proposalIdValue},timestamp:${timestamp}`;
      console.log('Template message để ký:', messageTemplate);
      
      // Yêu cầu người dùng xác thực trực tiếp với WebAuthn - không chỉ định credential ID
      // allowEmpty = true cho phép người dùng chọn từ danh sách các credential đã đăng ký
      const assertion = await getWebAuthnAssertion(null, messageTemplate, true);
      
      // Lấy credential ID từ assertion hoặc clientDataJSON
      const clientDataObj = JSON.parse(new TextDecoder().decode(assertion.clientDataJSON));
      const credentialId = clientDataObj.credential?.id;
      
      if (!credentialId) {
        throw new Error('Không nhận được credential ID từ WebAuthn');
      }
      
      console.log('Đã nhận credential ID từ WebAuthn:', credentialId);
      
      // Lấy thông tin guardian từ Firebase dựa trên credential đã chọn
      const guardianInfo = await getWalletByCredentialId(credentialId);
      if (!guardianInfo) {
        throw new Error('Không tìm thấy thông tin guardian trong Firebase');
      }
      
      // Sử dụng guardianId từ Firebase
      if (!guardianInfo.guardianId) {
        throw new Error('Không tìm thấy guardianId trong thông tin guardian');
      }
      
      const guardianId = guardianInfo.guardianId;
      console.log('Guardian ID từ Firebase:', guardianId);
      
      // Lấy WebAuthn public key từ Firebase
      if (!guardianInfo.guardianPublicKey || guardianInfo.guardianPublicKey.length === 0) {
        throw new Error('Không tìm thấy WebAuthn public key trong Firebase');
      }
      
      // Tạo transaction để ký đề xuất
      const tx = await createApproveProposalTx(
        new PublicKey(proposal.accountData.proposalPDA),
        multisigPDA,
        guardianPDA,
        guardianId,
        publicKey,
        assertion.signature,
        assertion.authenticatorData,
        assertion.clientDataJSON,
        proposalIdValue,
        timestamp
      );
      
      // Gửi transaction
      const signature = await sendTransaction(tx, connection);
      console.log('Đã ký đề xuất, signature:', signature);
      
      // Cập nhật UI
      setSuccess('Ký đề xuất thành công!');
      
      // Cập nhật danh sách người ký
      setProposal({
        ...proposal,
        signers: [...proposal.signers, publicKey.toBase58()]
      });
      
      setSigningLoading(false);
    } catch (error: any) {
      console.error('Lỗi khi ký đề xuất:', error);
      
      // Xử lý và hiển thị lỗi chi tiết từ blockchain
      let errorMessage = "Không thể ký đề xuất";
      
      // Lấy logs từ kết quả simulation nếu có
      if (error.logs) {
        console.error("Logs từ blockchain:", error.logs);
        errorMessage += "\n\nChi tiết từ blockchain:\n" + error.logs.join('\n');
      }
      
      // Lấy thông tin chi tiết từ transaction nếu có signature
      if (error.signature) {
        try {
          const txInfo = await connection.getTransaction(error.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });
          
          if (txInfo?.meta?.logMessages) {
            console.error("Chi tiết logs từ blockchain:", txInfo.meta.logMessages);
            errorMessage += "\n\nLogs chi tiết:\n" + txInfo.meta.logMessages.join('\n');
          }
        } catch (e) {
          console.error("Không thể lấy thông tin giao dịch:", e);
        }
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
      } else if (error.message.includes("Instruction #")) {
        errorMessage = `Lỗi instruction: ${error.message}`;
        if (error.message.includes("Instruction #1 Failed")) {
          errorMessage += "\nĐể biết thêm chi tiết, vui lòng kiểm tra logs ở console hoặc xem trên Solana Explorer";
        }
      } else {
        errorMessage += `: ${error.message}`;
      }
      
      setError(errorMessage);
      setSigningLoading(false);
    }
  };
  
  // Xử lý thực thi đề xuất
  const handleExecute = async () => {
    if (!publicKey || !program || !multisigPDA || !proposal) {
      setError('Không đủ thông tin để thực thi đề xuất.');
      return;
    }
    
    try {
      setExecutingLoading(true);
      setError(null);
      
      // Tạo transaction để thực thi đề xuất
      const tx = await createExecuteProposalTx(
        new PublicKey(proposal.accountData.proposalPDA),
        multisigPDA,
        publicKey
      );
      
      // Gửi transaction
      const signature = await sendTransaction(tx, connection, {
        skipPreflight: false,  // Thay đổi để bắt lỗi sớm
        preflightCommitment: 'confirmed'
      });
      console.log('Đã thực thi đề xuất, signature:', signature);
      
      // Cập nhật UI
      setSuccess('Thực thi đề xuất thành công!');
      setProposal({
        ...proposal,
        status: 'executed',
        executed: true
      });
      
      setExecutingLoading(false);
    } catch (error: any) {
      console.error('Lỗi khi thực thi đề xuất:', error);
      
      // Xử lý và hiển thị lỗi chi tiết từ blockchain
      let errorMessage = "Không thể thực thi đề xuất";
      
      // Lấy logs từ kết quả simulation nếu có
      if (error.logs) {
        console.error("Logs từ blockchain:", error.logs);
        errorMessage += "\n\nChi tiết từ blockchain:\n" + error.logs.join('\n');
      }
      
      // Lấy thông tin chi tiết từ transaction nếu có signature
      if (error.signature) {
        try {
          const txInfo = await connection.getTransaction(error.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });
          
          if (txInfo?.meta?.logMessages) {
            console.error("Chi tiết logs từ blockchain:", txInfo.meta.logMessages);
            errorMessage += "\n\nLogs chi tiết:\n" + txInfo.meta.logMessages.join('\n');
          }
        } catch (e) {
          console.error("Không thể lấy thông tin giao dịch:", e);
        }
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
              errorMessage = "Không đủ chữ ký để thực thi đề xuất";
              break;
            case "0x8":
              errorMessage = "Đề xuất đã được thực thi trước đó";
              break;
            default:
              errorMessage = `Lỗi chương trình: ${errorCode}`;
          }
        }
      } else if (error.message.includes("Instruction #")) {
        errorMessage = `Lỗi instruction: ${error.message}`;
        if (error.message.includes("Instruction #1 Failed")) {
          errorMessage += "\nĐể biết thêm chi tiết, vui lòng kiểm tra logs ở console hoặc xem trên Solana Explorer";
        }
      } else {
        errorMessage += `: ${error.message}`;
      }
      
      setError(errorMessage);
      setExecutingLoading(false);
    }
  };
  
  // Mở hộp thoại xác nhận
  const openConfirmDialog = (actionType: 'sign' | 'execute') => {
    setAction(actionType);
    setConfirmOpen(true);
  };
  
  // Xử lý hành động xác nhận
  const handleConfirmedAction = () => {
    setConfirmOpen(false);
    if (action === 'sign') {
      handleSign();
    } else if (action === 'execute') {
      handleExecute();
    }
  };
  
  if (loading || multisigLoading) {
    return (
      <Container maxWidth="md" sx={{ mt: 4, textAlign: 'center' }}>
        <CircularProgress />
        <Typography variant="h6" sx={{ mt: 2 }}>
          Đang tải chi tiết đề xuất...
        </Typography>
      </Container>
    );
  }
  
  if (error && !proposal) {
    return (
      <Container maxWidth="md" sx={{ mt: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button 
          startIcon={<ArrowBackIcon />} 
          variant="outlined" 
          onClick={() => navigate('/proposals')}
        >
          Quay lại danh sách đề xuất
        </Button>
      </Container>
    );
  }
  
  if (!proposal) {
    return (
      <Container maxWidth="md" sx={{ mt: 4 }}>
        <Alert severity="warning">
          Không tìm thấy đề xuất với ID: {proposalId}
        </Alert>
        <Button 
          startIcon={<ArrowBackIcon />} 
          variant="outlined" 
          onClick={() => navigate('/proposals')}
          sx={{ mt: 2 }}
        >
          Quay lại danh sách đề xuất
        </Button>
      </Container>
    );
  }
  
  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      {/* Header và nút quay lại */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Button 
          startIcon={<ArrowBackIcon />} 
          variant="outlined" 
          onClick={() => navigate('/proposals')}
          sx={{ mr: 2 }}
        >
          Quay lại
        </Button>
        <Typography variant="h5" component="h1" fontWeight="bold">
          Chi tiết đề xuất
        </Typography>
      </Box>
      
      {/* Thông báo thành công/lỗi */}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}
      
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      
      {/* Thông tin chính của đề xuất */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ width: '100%' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Typography variant="h6" component="div">
                    {proposal.proposalType === 'transfer' ? 'Chuyển tiền' : proposal.proposalType}
                  </Typography>
                  <Box sx={{ ml: 2 }}>
                    {renderStatusChip(proposal.status)}
                  </Box>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  ID: {proposal.id}
                </Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
            </Box>
            
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Chi tiết giao dịch
                </Typography>
                
                {proposal.proposalType === 'transfer' && (
                  <>
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        Số tiền
                      </Typography>
                      <Typography variant="h6" fontWeight="bold" color="primary">
                        {formatLamportsToSOL(proposal.amount)} SOL
                      </Typography>
                    </Box>
                    
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        Địa chỉ người nhận
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Typography 
                          variant="body2" 
                          sx={{ 
                            fontFamily: 'monospace', 
                            bgcolor: 'grey.100', 
                            p: 1, 
                            borderRadius: 1,
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          {proposal.destination}
                        </Typography>
                        <Tooltip title="Sao chép địa chỉ">
                          <Button 
                            size="small" 
                            onClick={() => copyToClipboard(proposal.destination)}
                            sx={{ minWidth: 'auto', ml: 1 }}
                          >
                            <ContentCopyIcon fontSize="small" />
                          </Button>
                        </Tooltip>
                      </Box>
                    </Box>
                    
                    {proposal.description && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Mô tả
                        </Typography>
                        <Typography variant="body2">
                          {proposal.description}
                        </Typography>
                      </Box>
                    )}
                  </>
                )}
                
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Thời gian tạo
                  </Typography>
                  <Typography variant="body2">
                    {formatTimestamp(proposal.timestamp)}
                  </Typography>
                </Box>
                
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Người tạo
                  </Typography>
                  <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                    {shortenAddress(proposal.creator)}
                    {proposal.creator === publicKey?.toBase58() && (
                      <Chip 
                        label="Bạn" 
                        size="small" 
                        color="primary" 
                        sx={{ ml: 1, height: 20, fontSize: '0.6rem' }} 
                      />
                    )}
                  </Typography>
                </Box>
              </Box>
              
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Trạng thái chữ ký
                </Typography>
                
                <Box sx={{ mb: 2, display: 'flex', alignItems: 'center' }}>
                  <Box sx={{ 
                    width: '100%', 
                    position: 'relative', 
                    height: 8, 
                    bgcolor: 'grey.200', 
                    borderRadius: 4,
                    overflow: 'hidden'
                  }}>
                    <Box sx={{ 
                      position: 'absolute', 
                      left: 0, 
                      top: 0, 
                      height: '100%', 
                      width: `${(proposal.signers.length / proposal.requiredSignatures) * 100}%`, 
                      bgcolor: 'primary.main', 
                      borderRadius: 4 
                    }} />
                  </Box>
                  <Typography variant="body2" fontWeight="bold" sx={{ ml: 2 }}>
                    {proposal.signers.length}/{proposal.requiredSignatures}
                  </Typography>
                </Box>
                
                <Paper variant="outlined" sx={{ p: 2, mb: 2, maxHeight: 250, overflow: 'auto' }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Danh sách người ký
                  </Typography>
                  
                  {proposal.accountData.guardians.map((guardian: string) => (
                    <SignerItem 
                      key={guardian}
                      signer={guardian}
                      isCurrent={publicKey?.toBase58() === guardian}
                      hasSigned={proposal.signers.includes(guardian)}
                    />
                  ))}
                </Paper>
                
                {proposal.status === 'pending' && (
                  <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
                    {!hasCurrentUserSigned() && (
                      <Button 
                        variant="contained" 
                        color="primary"
                        startIcon={<VerifiedUserIcon />}
                        onClick={() => openConfirmDialog('sign')}
                        disabled={signingLoading}
                        fullWidth
                      >
                        {signingLoading ? <CircularProgress size={24} /> : 'Ký đề xuất'}
                      </Button>
                    )}
                    
                    {(hasCurrentUserSigned() && hasEnoughSignatures() && !proposal.executed) && (
                      <Button 
                        variant="contained" 
                        color="success"
                        startIcon={<CheckCircleIcon />}
                        onClick={() => openConfirmDialog('execute')}
                        disabled={executingLoading}
                        fullWidth
                      >
                        {executingLoading ? <CircularProgress size={24} /> : 'Thực thi giao dịch'}
                      </Button>
                    )}
                    
                    {(hasCurrentUserSigned() && !hasEnoughSignatures()) && (
                      <Alert severity="info" sx={{ width: '100%' }}>
                        Bạn đã ký đề xuất này. Cần thêm {proposal.requiredSignatures - proposal.signers.length} chữ ký để thực thi.
                      </Alert>
                    )}
                  </Stack>
                )}
                
                {proposal.status === 'executed' && (
                  <Alert severity="success" sx={{ mt: 2 }}>
                    Giao dịch đã được thực thi thành công.
                  </Alert>
                )}
                
                {proposal.status === 'rejected' && (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    Giao dịch đã bị từ chối.
                  </Alert>
                )}
              </Box>
            </Box>
          </Box>
        </CardContent>
      </Card>
      
      {/* Dialog xác nhận */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
      >
        <DialogTitle>
          {action === 'sign' ? 'Xác nhận ký đề xuất' : 'Xác nhận thực thi giao dịch'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {action === 'sign' 
              ? 'Bạn có chắc chắn muốn ký đề xuất này? Hành động này không thể hoàn tác.'
              : 'Bạn có chắc chắn muốn thực thi giao dịch này? Hành động này sẽ chuyển tiền và không thể hoàn tác.'}
          </DialogContentText>
          {action === 'execute' && proposal.proposalType === 'transfer' && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
              <Typography variant="subtitle2" gutterBottom>
                Chi tiết giao dịch:
              </Typography>
              <Typography variant="body2">
                Số tiền: <b>{formatLamportsToSOL(proposal.amount)} SOL</b>
              </Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                Người nhận: <b>{shortenAddress(proposal.destination)}</b>
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Hủy</Button>
          <Button 
            onClick={handleConfirmedAction} 
            variant="contained" 
            color={action === 'sign' ? 'primary' : 'success'}
          >
            {action === 'sign' ? 'Ký đề xuất' : 'Thực thi giao dịch'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default ProposalDetail; 