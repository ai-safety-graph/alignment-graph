import sqlite3
con = sqlite3.connect("data/arxiv_papers.db")
print("sqlite_version:", con.execute("select sqlite_version()").fetchone()[0])
print("max_variable_number:", con.execute("pragma max_variable_number").fetchone()[0])
print("#papers:", con.execute("select count(*) from papers").fetchone()[0])
print("#embeddings for model=specter2:", con.execute("select count(*) from embeddings where model=?", ("specter2",)).fetchone()[0])