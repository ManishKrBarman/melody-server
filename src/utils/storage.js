const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Backblaze B2 s3-compatible API
const s3 = new AWS.S3({
    endpoint: 'https://s3.us-east-005.backblazeb2.com',
    accessKeyId: process.env.B2_ACCOUNT_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY,
    region: 'us-east-005',
    signatureVersion: 'v4',
});

// Upload file to B2
const uploadFile = async (localFilePath, remoteFileName, mimeType) => {
    const fileContent = fs.readFileSync(localFilePath);

    const params = {
        Bucket: process.env.B2_BUCKET_NAME,
        Key: remoteFileName,
        Body: fileContent,
        ContentType: mimeType,
    };

    const result = await s3.upload(params).promise();
    return result.Location;
};

// Delete file from B2
const deleteFile = async (remoteFileName) => {
    const params = {
        Bucket: process.env.B2_BUCKET_NAME,
        Key: remoteFileName,
    };
    await s3.deleteObject(params).promise();
};

// Generate a signed URL (temporary access link — 1 hour)
const getSignedUrl = (remoteFileName) => {
    const params = {
        Bucket: process.env.B2_BUCKET_NAME,
        Key: remoteFileName,
        Expires: 3600, // 1 hour
    };
    return s3.getSignedUrl('getObject', params);
};

module.exports = { uploadFile, deleteFile, getSignedUrl };