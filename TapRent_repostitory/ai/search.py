import math
import os
from functools import lru_cache
from threading import Lock

MODEL_ID = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MODEL_LOCK = Lock()


@lru_cache(maxsize=2)
def load_model(local_only):
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(MODEL_ID, local_files_only=local_only)


def embedding_vectors(values):
    if os.getenv("TAPRENT_AI_DISABLED") == "1":
        raise RuntimeError("Model dinonaktifkan.")
    try:
        with MODEL_LOCK:
            vectors = load_model(True).encode(values, normalize_embeddings=True,
                                              show_progress_bar=False).tolist()
    except (ImportError, OSError, RuntimeError, ValueError) as error:
        raise RuntimeError("Model lokal tidak tersedia.") from error
    if len(vectors) != len(values) or not vectors or not vectors[0] or any(
        len(vector) != len(vectors[0]) or not all(math.isfinite(v) for v in vector)
        for vector in vectors
    ):
        raise ValueError("Embedding tidak valid")
    return "sentence_transformer", vectors


if __name__ == "__main__":
    load_model(False)
    print(f"Model siap di cache lokal: {MODEL_ID}")


def cosine(left, right):
    denominator = math.hypot(*left) * math.hypot(*right)
    return sum(a * b for a, b in zip(left, right)) / denominator if denominator else 0
