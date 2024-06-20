Hương dẫn chạy project 

chmod +x ./download-core.sh

./download-core.sh 1.24.1

yarn install

docker compose up -d

Check data được tạo trong DB mongo
node checkData.js
