from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
)

if "sqlite" in settings.DATABASE_URL:
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def init_fts5_and_db():
    Base.metadata.create_all(bind=engine)
    if "sqlite" in settings.DATABASE_URL:
        with engine.begin() as conn:
            # Create FTS5 Virtual Table for FoodCatalog
            conn.execute(text("""
                CREATE VIRTUAL TABLE IF NOT EXISTS food_catalog_fts USING fts5(
                    canonical_name,
                    username UNINDEXED,
                    content='food_catalog',
                    tokenize='porter unicode61'
                );
            """))
            # Auto-sync triggers for INSERT, UPDATE, DELETE
            conn.execute(text("""
                CREATE TRIGGER IF NOT EXISTS food_catalog_ai AFTER INSERT ON food_catalog BEGIN
                    INSERT INTO food_catalog_fts(rowid, canonical_name, username) 
                    VALUES (new.rowid, new.canonical_name, new.username);
                END;
            """))
            conn.execute(text("""
                CREATE TRIGGER IF NOT EXISTS food_catalog_ad AFTER DELETE ON food_catalog BEGIN
                    INSERT INTO food_catalog_fts(food_catalog_fts, rowid, canonical_name, username) 
                    VALUES ('delete', old.rowid, old.canonical_name, old.username);
                END;
            """))
            conn.execute(text("""
                CREATE TRIGGER IF NOT EXISTS food_catalog_au AFTER UPDATE ON food_catalog BEGIN
                    INSERT INTO food_catalog_fts(food_catalog_fts, rowid, canonical_name, username) 
                    VALUES ('delete', old.rowid, old.canonical_name, old.username);
                    INSERT INTO food_catalog_fts(rowid, canonical_name, username) 
                    VALUES (new.rowid, new.canonical_name, new.username);
                END;
            """))

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
