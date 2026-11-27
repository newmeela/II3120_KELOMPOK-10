import threading
from http.server import ThreadingHTTPServer

import pytest

from ai import search
from ai.search import cosine
from backend import main
from simulator.rfid import send


def test_sentence_transformer_adapter_with_controlled_embeddings(monkeypatch):
    class Model:
        def encode(self, texts, *, normalize_embeddings, show_progress_bar):
            assert texts == ["penyangga HP untuk rekam video", "Tripod Aluminium"]
            assert normalize_embeddings and not show_progress_bar
            return self

        def tolist(self):
            return [[0.8, 0.6], [0.6, 0.8]]

    monkeypatch.delenv("TAPRENT_AI_DISABLED", raising=False)
    monkeypatch.setattr(search, "load_model", lambda local_only: Model())
    mode, vectors = search.embedding_vectors(["penyangga HP untuk rekam video", "Tripod Aluminium"])
    assert mode == "sentence_transformer"
    assert cosine(*vectors) == pytest.approx(0.96)


def test_zero_vector():
    assert cosine([0, 0], [0, 0]) == 0


def test_simulator_contract(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "DB", str(tmp_path / "demo.sqlite3"))
    monkeypatch.setattr(main, "DEVICE_SEEN", {})
    monkeypatch.setenv("TAPRENT_DEVICE_KEY", "test-only")
    main.init()
    with ThreadingHTTPServer(("127.0.0.1", 0), main.Handler) as server:
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}"
            assert send(url, "heartbeat", main.DEVICE, "salah")[0] == 401
            status, body = send(url, "heartbeat", main.DEVICE, "test-only")
            assert status == 200 and body["online"] is True
            status, body = send(url, "scan", main.DEVICE, "test-only", "UNKNOWN", "demo-scan")
            assert status == 422 and body["event"]["result"] == "TAG_NOT_REGISTERED"
            status, body = send(url, "scan", main.DEVICE, "test-only", "UNKNOWN", "demo-scan")
            assert status == 409 and body["error"] == "DUPLICATE_SCAN_EVENT"
        finally:
            server.shutdown()
            thread.join()
