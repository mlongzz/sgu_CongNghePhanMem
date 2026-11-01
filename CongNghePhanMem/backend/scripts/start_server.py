"""Production entry point: Render provides PORT."""

import os
import uvicorn


def main():
    port = int(os.getenv("PORT", "8000"))
    if not 1 <= port <= 65535:
        raise ValueError("PORT must be between 1 and 65535")
    # App middleware records method/path/status, never query strings (which can contain GPS).
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, proxy_headers=True,
                access_log=os.getenv('APP_ENV') != 'production')


if __name__ == "__main__":
    main()
