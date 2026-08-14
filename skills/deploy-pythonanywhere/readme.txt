- User steps (Bash console): pip install --user -r requirements.txt nếu cần + cài CLI tool nếu cần
- Agent steps (MCP automation): upload code → tạo WSGI → tạo webapp → reload → E2E test
- Deploy update (code change): upload → xóa cache → reload → test

Không virtualenv. Không pytest. Không setup thủ công thừa.