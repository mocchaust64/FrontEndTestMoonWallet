# Hướng dẫn xử lý WebAuthn Credential IDs

## Vấn đề

Ứng dụng có thể gặp lỗi khi ký đề xuất vì hệ thống sử dụng các credential ID khác nhau giữa các quá trình:
- Khi **tạo đề xuất**, hệ thống sử dụng credential ID mà người dùng vừa chọn
- Khi **ký đề xuất**, hệ thống mặc định lấy credential ID từ `localStorage.getItem("userCredentials")`
- Nếu hai credential ID này khác nhau, public key không thể tìm thấy và giao dịch thất bại

## Triệu chứng gặp phải

Lỗi thường gặp:
```
Lỗi khi ký đề xuất: Error: Không tìm thấy public key cho credential ID: VqSV7w0c4+BBdCxxmI9/080SiFK2pux+RFqhbAMSnKc=. Khóa 'guardianPublicKey_56a495ef0d1ce3e041742c71988f7fd3cd128852b6a6ec7e445aa16c03129ca7' không tồn tại trong localStorage.
```

Trong khi log hiển thị credential ID sử dụng khi tạo đề xuất là:
```
Normalized Credential ID được sử dụng: 2aca510ffacef384a6990e9ea99f6e625571b7785615da535e2953657d41027f
```

## Giải pháp đã triển khai

1. Cập nhật hàm `getWebAuthnPublicKey` để nhận thêm tham số tùy chọn `overrideCredentialId`:
```typescript
async function getWebAuthnPublicKey(guardianPDA: PublicKey, overrideCredentialId?: string): Promise<Buffer>
```

2. Cập nhật hàm `createApproveProposalTx` để chấp nhận và truyền credential ID:
```typescript
export const createApproveProposalTx = async (
  // các tham số khác...
  credentialId?: string
): Promise<Transaction>
```

3. Khi người dùng ký đề xuất, truyền credential ID hiện tại vào hàm ký:
```typescript
const tx = await createApproveProposalTx(
  // các tham số khác...
  credentialIdString // Thêm credential ID hiện tại
);
```

## Cách sử dụng

Khi cần ký một đề xuất:

1. Luôn lấy credential ID từ người dùng qua WebAuthn:
```typescript
const credential = await navigator.credentials.get({...});
const credentialIdString = Buffer.from(credential.rawId).toString('base64');
```

2. Lưu public key vào localStorage theo credential ID đã chuẩn hóa:
```typescript
const normalizedCredentialId = normalizeCredentialId(credentialIdString);
const credentialSpecificKey = `guardianPublicKey_${normalizedCredentialId}`;
localStorage.setItem(credentialSpecificKey, guardianPublicKey);
```

3. Khi ký đề xuất, truyền credential ID vào hàm createApproveProposalTx:
```typescript
const tx = await createApproveProposalTx(
  // các tham số khác...
  credentialIdString
);
```

## Thực tiễn tốt nhất

1. **Không bao giờ giả định credential ID**: Luôn sử dụng credential ID mà người dùng vừa chọn thông qua WebAuthn, không dựa vào localStorage.

2. **Lưu public key theo credential ID**: Mỗi credential ID nên có một public key riêng được lưu trữ với khóa `guardianPublicKey_${normalizedCredentialId}`.

3. **Chuẩn hóa nhất quán**: Đảm bảo sử dụng cùng một hàm `normalizeCredentialId` trong toàn bộ ứng dụng.

4. **Log chi tiết**: Luôn log đầy đủ credential ID và public key để dễ dàng gỡ lỗi.

5. **Truyền credential ID trong cả chuỗi**: Trong chuỗi gọi hàm, truyền credential ID từ nguồn gốc đến các hàm cuối cùng.

## Lưu ý quan trọng

- Người dùng có thể có nhiều credential ID trên cùng một thiết bị, đặc biệt khi đăng ký nhiều lần.
- Credential ID được tạo ra từ trình duyệt/thiết bị và có thể thay đổi theo thời gian.
- Một public key có thể liên kết với nhiều credential ID khác nhau.
- Lưu ý credential ID có thể khác nhau giữa các trình duyệt và thiết bị. 