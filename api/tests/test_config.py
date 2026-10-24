from app.config import Settings


def test_cors_origins_match_what_the_browser_sends():
    # The browser sends "https://host"; a pasted trailing slash, path, capitals or spaces must not block the web app.
    s = Settings(cors_origins=" https://levelos-nine.vercel.app/ ,http://localhost:5173,https://LevelOS.vercel.app/login,, *")
    assert s.cors_origin_list == [
        "https://levelos-nine.vercel.app",
        "http://localhost:5173",
        "https://levelos.vercel.app",
        "*",
    ]
