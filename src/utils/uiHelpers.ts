/**
 * Tiện ích để định dạng và hiển thị dữ liệu trong UI
 */

import { LAMPORTS_PER_SOL } from '@solana/web3.js';

/**
 * Chuyển đổi lamports sang SOL với định dạng đẹp
 * @param lamports Số lượng lamports
 * @returns Chuỗi định dạng số SOL
 */
export const formatLamportsToSOL = (lamports: number): string => {
  const solValue = lamports / LAMPORTS_PER_SOL;
  return solValue.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 9
  });
};

/**
 * Rút gọn địa chỉ để hiển thị
 * @param address Địa chỉ đầy đủ
 * @param startChars Số ký tự đầu hiển thị (mặc định 4)
 * @param endChars Số ký tự cuối hiển thị (mặc định 4)
 * @returns Địa chỉ đã được rút gọn
 */
export const shortenAddress = (address: string, startChars: number = 4, endChars: number = 4): string => {
  if (!address || address.length < startChars + endChars + 3) {
    return address || '';
  }
  
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
};

/**
 * Định dạng timestamp thành chuỗi hiển thị
 * @param timestamp Timestamp Unix (milliseconds)
 * @returns Chuỗi định dạng thời gian
 */
export const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  
  // Nếu thời gian trong cùng ngày hôm nay, chỉ hiển thị giờ
  const today = new Date();
  if (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  ) {
    return date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  
  // Nếu thời gian trong vòng 7 ngày qua, hiển thị tên thứ
  const diffDays = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    const weekday = date.toLocaleDateString('vi-VN', { weekday: 'long' });
    return `${weekday}, ${date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit'
    })}`;
  }
  
  // Các trường hợp khác, hiển thị ngày tháng đầy đủ
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/**
 * Lấy trạng thái đề xuất từ dữ liệu gốc
 * @param statusCode Dữ liệu trạng thái đề xuất (có thể là số hoặc chuỗi)
 * @returns Chuỗi trạng thái ('pending', 'executed', 'rejected')
 */
export const getProposalStatus = (statusCode: number | string): string => {
  // Nếu statusCode là string, trả về trực tiếp nếu đã là giá trị hợp lệ
  if (typeof statusCode === 'string') {
    const status = statusCode.toLowerCase();
    if (['pending', 'executed', 'rejected', 'expired'].includes(status)) {
      return status;
    }
    // Thử chuyển đổi sang số nếu không phải là giá trị string hợp lệ
    const numericStatus = parseInt(statusCode);
    if (!isNaN(numericStatus)) {
      return getProposalStatus(numericStatus);
    }
    return 'unknown';
  }
  
  // Xử lý cho trường hợp statusCode là số
  switch (statusCode) {
    case 0:
      return 'pending';
    case 1:
      return 'executed';
    case 2:
      return 'rejected';
    case 3:
      return 'expired';
    default:
      return 'unknown';
  }
};

/**
 * Tính toán thời gian còn lại để hiển thị
 * @param expiryTimestamp Thời gian hết hạn
 * @returns Chuỗi thời gian còn lại
 */
export const getTimeRemaining = (expiryTimestamp: number): string => {
  const now = new Date().getTime();
  const remaining = expiryTimestamp - now;
  
  if (remaining <= 0) return 'Đã hết hạn';
  
  const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
  const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  
  if (days > 0) {
    return `${days} ngày ${hours} giờ`;
  } else if (hours > 0) {
    return `${hours} giờ ${minutes} phút`;
  } else {
    return `${minutes} phút`;
  }
};

/**
 * Chuyển đổi loại đề xuất thành chuỗi có thể đọc
 * @param type Loại đề xuất từ blockchain
 * @returns Chuỗi loại đề xuất có thể đọc
 */
export const getProposalTypeText = (type: string): string => {
  switch (type) {
    case 'transfer':
      return 'Chuyển tiền';
    case 'add_guardian':
      return 'Thêm người giám hộ';
    case 'remove_guardian':
      return 'Xóa người giám hộ';
    case 'change_threshold':
      return 'Đổi ngưỡng ký';
    default:
      return type || 'Không xác định';
  }
}; 