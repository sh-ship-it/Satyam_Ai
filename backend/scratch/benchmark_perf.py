import os
import sys
import time
import asyncio
import json
from statistics import mean, median
from typing import List, Dict, Any

# Ensure backend directory is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# ─────────────────────────────────────────────────────────────────────────────
# PyTorch Direct Workaround for BGE Models (Bypassing sentence-transformers crash)
# ─────────────────────────────────────────────────────────────────────────────
import torch
from transformers import AutoTokenizer, AutoModel, AutoModelForSequenceClassification

class PyTorchBgeM3Embedder:
    def __init__(self, dim=1024):
        self.dim = dim
        print("Initializing BGE-M3 on GPU via PyTorch direct...")
        self.tokenizer = AutoTokenizer.from_pretrained('backend/models/bge-m3')
        self.model = AutoModel.from_pretrained('backend/models/bge-m3').to('cuda')
        self.model.eval()
        print("BGE-M3 loaded successfully on CUDA!")
        
    async def embed(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        
        def _run():
            encoded = self.tokenizer(texts, padding=True, truncation=True, max_length=8192, return_tensors='pt').to('cuda')
            with torch.no_grad():
                out = self.model(**encoded)
                # CLS pooling
                embeddings = out[0][:, 0]
                # L2 normalize (unit vectors => cosine similarity == dot product)
                embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)
            return embeddings.cpu().tolist()
            
        return await asyncio.to_thread(_run)

class PyTorchBgeReranker:
    def __init__(self):
        print("Initializing BGE-Reranker-v2-m3 on GPU via PyTorch direct...")
        self.tokenizer = AutoTokenizer.from_pretrained('backend/models/bge-reranker-v2-m3')
        self.model = AutoModelForSequenceClassification.from_pretrained('backend/models/bge-reranker-v2-m3').to('cuda')
        self.model.eval()
        print("BGE-Reranker loaded successfully on CUDA!")
        
    async def rerank(self, query: str, candidates: List[str]) -> List[int]:
        if not candidates:
            return []
        
        def _run():
            pairs = [[query, c] for c in candidates]
            encoded = self.tokenizer(pairs, padding=True, truncation=True, max_length=512, return_tensors='pt').to('cuda')
            with torch.no_grad():
                logits = self.model(**encoded).logits.squeeze(-1)
            
            # Handle single candidate edge case
            if len(candidates) == 1:
                scores = [logits.item()]
            else:
                scores = logits.tolist()
                
            # Return sorted indices descending
            return sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
            
        return await asyncio.to_thread(_run)

# Instantiate the direct models
_embedder_instance = PyTorchBgeM3Embedder()
_reranker_instance = PyTorchBgeReranker()

# Monkeypatch the model registry BEFORE importing app.pipeline or app.db.session
import app.models.registry as registry
registry.get_embedder = lambda: _embedder_instance
registry.get_reranker = lambda: _reranker_instance

# ─────────────────────────────────────────────────────────────────────────────
# Now import the rest of the application safely
# ─────────────────────────────────────────────────────────────────────────────
from app.config import get_settings
from app.models.registry import get_llm, get_fallback_llm
from app.db.session import get_sessionmaker
from app.core.rbac import Principal
from app.core.audit import write_audit, verify_chain
from app.db.rls import apply_rls_context
from app.pipeline import orchestrator
from app.pipeline.slots import ConversationState
from sqlalchemy import text


async def benchmark_local_embeddings():
    print("\n=== Benchmarking BGE-M3 Embeddings (Local GPU) ===")
    try:
        single_text = "Identify the suspect in robbery cases in Bengaluru."
        batch_texts = [
            f"This is test document number {i} for batch embedding performance measurement."
            for i in range(10)
        ]
        
        # Warmup
        await _embedder_instance.embed([single_text])
        
        # Single Embeddings
        latencies = []
        for _ in range(10):
            start = time.perf_counter()
            await _embedder_instance.embed([single_text])
            latencies.append((time.perf_counter() - start) * 1000)
            
        print(f"Single Embed Latency: mean={mean(latencies):.2f}ms, min={min(latencies):.2f}ms, max={max(latencies):.2f}ms, p50={median(latencies):.2f}ms")
        
        # Batch Embeddings (Batch Size 10)
        batch_latencies = []
        for _ in range(5):
            start = time.perf_counter()
            await _embedder_instance.embed(batch_texts)
            batch_latencies.append((time.perf_counter() - start) * 1000)
            
        print(f"Batch (size=10) Latency: mean={mean(batch_latencies):.2f}ms, min={min(batch_latencies):.2f}ms, max={max(batch_latencies):.2f}ms")
        throughput = (10 / (mean(batch_latencies) / 1000))
        print(f"Batch Embedding Throughput: {throughput:.2f} docs/sec")
        
        return {
            "single_latency_mean_ms": mean(latencies),
            "single_latency_min_ms": min(latencies),
            "single_latency_max_ms": max(latencies),
            "single_latency_p50_ms": median(latencies),
            "batch_10_latency_mean_ms": mean(batch_latencies),
            "batch_throughput_docs_sec": throughput,
        }
    except Exception as e:
        print(f"Error benchmarking embeddings: {e}")
        return {"error": str(e)}


async def benchmark_local_reranker():
    print("\n=== Benchmarking BGE-Reranker-v2-m3 (Local GPU) ===")
    try:
        query = "Where did the robbery take place?"
        candidates_5 = ["The robbery occurred in Jayanagar 4th block near the temple."] * 5
        candidates_10 = ["The robbery occurred in Jayanagar 4th block near the temple."] * 10
        candidates_20 = ["The robbery occurred in Jayanagar 4th block near the temple."] * 20
        
        # Warmup
        await _reranker_instance.rerank(query, ["warmup"])
        
        # Rerank 5
        lat_5 = []
        for _ in range(5):
            start = time.perf_counter()
            await _reranker_instance.rerank(query, candidates_5)
            lat_5.append((time.perf_counter() - start) * 1000)
            
        # Rerank 10
        lat_10 = []
        for _ in range(5):
            start = time.perf_counter()
            await _reranker_instance.rerank(query, candidates_10)
            lat_10.append((time.perf_counter() - start) * 1000)
            
        # Rerank 20
        lat_20 = []
        for _ in range(5):
            start = time.perf_counter()
            await _reranker_instance.rerank(query, candidates_20)
            lat_20.append((time.perf_counter() - start) * 1000)
            
        print(f"Rerank 5 Candidates: mean={mean(lat_5):.2f}ms, min={min(lat_5):.2f}ms, max={max(lat_5):.2f}ms")
        print(f"Rerank 10 Candidates: mean={mean(lat_10):.2f}ms, min={min(lat_10):.2f}ms, max={max(lat_10):.2f}ms")
        print(f"Rerank 20 Candidates: mean={mean(lat_20):.2f}ms, min={min(lat_20):.2f}ms, max={max(lat_20):.2f}ms")
        
        return {
            "rerank_5_mean_ms": mean(lat_5),
            "rerank_10_mean_ms": mean(lat_10),
            "rerank_20_mean_ms": mean(lat_20),
        }
    except Exception as e:
        print(f"Error benchmarking reranker: {e}")
        return {"error": str(e)}


async def benchmark_database():
    print("\n=== Benchmarking Neon PostgreSQL & Security Layer ===")
    results = {}
    sm = get_sessionmaker()
    
    # 1. Simple DB Read
    try:
        db_read_lat = []
        async with sm() as session:
            # Warmup
            await session.execute(text("SELECT 1"))
            
            for _ in range(10):
                start = time.perf_counter()
                res = await session.execute(text("SELECT COUNT(*) FROM cases"))
                count = res.scalar()
                db_read_lat.append((time.perf_counter() - start) * 1000)
        print(f"Simple COUNT(*) Query: mean={mean(db_read_lat):.2f}ms, min={min(db_read_lat):.2f}ms, count={count}")
        results["count_query_mean_ms"] = mean(db_read_lat)
        results["total_cases_in_db"] = count
    except Exception as e:
        print(f"Error simple query: {e}")
        results["count_query_error"] = str(e)

    # 2. pgvector Semantic Search
    try:
        vector_search_lat = []
        # Generate a dummy 1024-dim vector
        dummy_vector = [0.01] * 1024
        vec_literal = "[" + ",".join(f"{x:.6f}" for x in dummy_vector) + "]"
        vt = get_settings().vector_type
        
        async with sm() as session:
            sql = text(f"SELECT case_id, body FROM narratives WHERE embedding IS NOT NULL ORDER BY embedding <=> (:qvec)::{vt} LIMIT 5")
            # Warmup
            await session.execute(sql, {"qvec": vec_literal})
            
            for _ in range(5):
                start = time.perf_counter()
                res = await session.execute(sql, {"qvec": vec_literal})
                rows = res.all()
                vector_search_lat.append((time.perf_counter() - start) * 1000)
        print(f"pgvector Cosine Search (k=5): mean={mean(vector_search_lat):.2f}ms, min={min(vector_search_lat):.2f}ms, returned={len(rows)}")
        results["pgvector_search_mean_ms"] = mean(vector_search_lat)
    except Exception as e:
        print(f"Error pgvector query: {e}")
        results["pgvector_search_error"] = str(e)

    # 3. RLS Overhead
    try:
        rls_no_context_lat = []
        rls_with_context_lat = []
        
        # Test Query (against cases table which has RLS policies)
        sql = text("SELECT COUNT(*) FROM cases WHERE crime_type = 'THEFT'")
        
        async with sm() as session:
            # Without Context
            for _ in range(5):
                start = time.perf_counter()
                await session.execute(sql)
                rls_no_context_lat.append((time.perf_counter() - start) * 1000)
                
            # With Context (L1 - Station scope, very restrictive)
            for _ in range(5):
                start = time.perf_counter()
                await apply_rls_context(
                    session,
                    scope="station",
                    range_name="Bengaluru City",
                    district="Bengaluru City",
                    station_id=1,
                    clearance=1
                )
                await session.execute(sql)
                # Rollback or end to clear GUCs (GUCs are local to transaction/session)
                await session.rollback()
                rls_with_context_lat.append((time.perf_counter() - start) * 1000)
                
        print(f"RLS Query WITHOUT Context: mean={mean(rls_no_context_lat):.2f}ms")
        print(f"RLS Query WITH Context (Station level): mean={mean(rls_with_context_lat):.2f}ms")
        overhead = mean(rls_with_context_lat) - mean(rls_no_context_lat)
        print(f"RLS Security Overhead: {overhead:.2f}ms ({(overhead/mean(rls_no_context_lat))*100:.1f}%)")
        
        results["rls_no_context_mean_ms"] = mean(rls_no_context_lat)
        results["rls_with_context_mean_ms"] = mean(rls_with_context_lat)
        results["rls_overhead_ms"] = overhead
    except Exception as e:
        print(f"Error benchmarking RLS: {e}")
        results["rls_error"] = str(e)

    # 4. Audit Log Write Speed & Advisory Lock
    try:
        audit_write_lat = []
        async with sm() as session:
            for i in range(5):
                start = time.perf_counter()
                # Run write_audit in a new transaction
                await write_audit(
                    session,
                    action="PERF_TEST",
                    user_id=1,
                    query_text=f"Benchmark run transaction {i}",
                )
                await session.commit()
                audit_write_lat.append((time.perf_counter() - start) * 1000)
                
        print(f"Single Audit Write & Hash: mean={mean(audit_write_lat):.2f}ms, min={min(audit_write_lat):.2f}ms")
        results["audit_write_single_mean_ms"] = mean(audit_write_lat)
        
        # Concurrent Writes (Simulating 5 concurrent requests writing to audit log)
        async def concurrent_write_task(idx):
            async with sm() as session:
                start = time.perf_counter()
                await write_audit(
                    session,
                    action="PERF_TEST_CONCURRENT",
                    user_id=1,
                    query_text=f"Concurrent benchmark run {idx}",
                )
                await session.commit()
                return (time.perf_counter() - start) * 1000
                
        start_concurrent = time.perf_counter()
        durations = await asyncio.gather(*(concurrent_write_task(i) for i in range(5)))
        total_concurrent_time = (time.perf_counter() - start_concurrent) * 1000
        
        print(f"5 Concurrent Audit Writes (Advisory locked): total_duration={total_concurrent_time:.2f}ms, individual_mean={mean(durations):.2f}ms")
        results["audit_write_concurrent_total_ms"] = total_concurrent_time
        results["audit_write_concurrent_individual_mean_ms"] = mean(durations)
        
        # Verification Chain Performance
        async with sm() as session:
            start = time.perf_counter()
            chain_ok = await verify_chain(session)
            chain_verify_time = (time.perf_counter() - start) * 1000
            
        print(f"Audit Hash Chain Verification: ok={chain_ok}, duration={chain_verify_time:.2f}ms")
        results["audit_chain_verify_ms"] = chain_verify_time
        results["audit_chain_integrity_verified"] = chain_ok
        
    except Exception as e:
        print(f"Error benchmarking audit log: {e}")
        results["audit_error"] = str(e)
        
    return results


async def benchmark_llm_api():
    print("\n=== Benchmarking Cloud LLM APIs ===")
    results = {}
    
    # 1. Gemini 2.5 Flash
    try:
        llm = get_llm("gemini")
        prompt = "What is the capital of Karnataka? Respond in exactly 1 word."
        
        # Measure latency
        start = time.perf_counter()
        response = await llm.complete(prompt, temperature=0.0)
        duration = time.perf_counter() - start
        
        # Rough token count (4 chars/token)
        input_tokens = len(prompt) / 4
        output_tokens = len(response) / 4
        total_tokens = input_tokens + output_tokens
        
        print(f"Gemini 2.5 Flash complete(): duration={duration:.2f}s, response='{response.strip()}'")
        results["gemini"] = {
            "duration_sec": duration,
            "response": response.strip(),
            "throughput_tokens_sec": total_tokens / duration if duration > 0 else 0,
        }
    except Exception as e:
        print(f"Error benchmarking Gemini API: {e}")
        results["gemini"] = {"error": str(e)}

    # 2. Groq Llama-3.3-70B
    try:
        llm = get_llm("groq")
        prompt = "What is the capital of Karnataka? Respond in exactly 1 word."
        
        start = time.perf_counter()
        response = await llm.complete(prompt, temperature=0.0)
        duration = time.perf_counter() - start
        
        input_tokens = len(prompt) / 4
        output_tokens = len(response) / 4
        total_tokens = input_tokens + output_tokens
        
        print(f"Groq Llama-3.3-70B complete(): duration={duration:.2f}s, response='{response.strip()}'")
        results["groq"] = {
            "duration_sec": duration,
            "response": response.strip(),
            "throughput_tokens_sec": total_tokens / duration if duration > 0 else 0,
        }
    except Exception as e:
        print(f"Error benchmarking Groq API: {e}")
        results["groq"] = {"error": str(e)}
        
    return results


async def benchmark_pipelines():
    print("\n=== Benchmarking E2E Conversational Pipelines (SSE Stream) ===")
    results = {}
    
    principal = Principal(
        id="P1",
        name="Officer Satish",
        rank="SP",
        scope="state",
        clearance=4,
        officer_id=1,
        station_id=None,
        district="Bengaluru City"
    )
    
    sm = get_sessionmaker()
    
    # 1. Smalltalk Pipeline
    try:
        state = ConversationState()
        events = []
        start = time.perf_counter()
        ttft = None
        
        async with sm() as session:
            async for event in orchestrator.run(
                message="Hello Satyam, who are you?",
                principal=principal,
                session=session,
                state=state,
                lang="en"
            ):
                events.append(event)
                if event.type == "token" and ttft is None:
                    ttft = (time.perf_counter() - start) * 1000
                    
        total_time = (time.perf_counter() - start) * 1000
        tokens = [e.data["text"] for e in events if e.type == "token"]
        text_response = "".join(tokens)
        
        print(f"Smalltalk E2E: total={total_time:.2f}ms, TTFT={ttft:.2f}ms, tokens_emitted={len(tokens)}")
        results["smalltalk"] = {
            "total_ms": total_time,
            "ttft_ms": ttft,
            "token_count": len(tokens),
            "response_snippet": text_response[:100] + "...",
        }
    except Exception as e:
        print(f"Error benchmarking smalltalk pipeline: {e}")
        results["smalltalk"] = {"error": str(e)}

    # 2. Text-to-SQL Pipeline
    try:
        state = ConversationState()
        events = []
        start = time.perf_counter()
        ttft = None
        sql_used = None
        
        async with sm() as session:
            async for event in orchestrator.run(
                message="how many theft cases are there in Bengaluru in 2025?",
                principal=principal,
                session=session,
                state=state,
                lang="en"
            ):
                events.append(event)
                if event.type == "token" and ttft is None:
                    ttft = (time.perf_counter() - start) * 1000
                if event.type == "tool" and event.data.get("name") == "text_to_sql" and event.data.get("status") == "end":
                    sql_used = event.data.get("detail")
                    
        total_time = (time.perf_counter() - start) * 1000
        tokens = [e.data["text"] for e in events if e.type == "token"]
        
        print(f"Text-to-SQL E2E: total={total_time:.2f}ms, TTFT={ttft:.2f}ms, sql='{sql_used}'")
        results["text_to_sql"] = {
            "total_ms": total_time,
            "ttft_ms": ttft,
            "sql_used": sql_used,
            "token_count": len(tokens),
        }
    except Exception as e:
        print(f"Error benchmarking Text-to-SQL pipeline: {e}")
        results["text_to_sql"] = {"error": str(e)}

    # 3. RAG (Narrative Search) Pipeline
    try:
        state = ConversationState()
        events = []
        start = time.perf_counter()
        ttft = None
        
        async with sm() as session:
            async for event in orchestrator.run(
                message="find suspect details in case narratives involving house theft or burglary",
                principal=principal,
                session=session,
                state=state,
                lang="en"
            ):
                events.append(event)
                if event.type == "token" and ttft is None:
                    ttft = (time.perf_counter() - start) * 1000
                    
        total_time = (time.perf_counter() - start) * 1000
        tokens = [e.data["text"] for e in events if e.type == "token"]
        
        print(f"RAG E2E: total={total_time:.2f}ms, TTFT={ttft:.2f}ms, tokens_emitted={len(tokens)}")
        results["rag"] = {
            "total_ms": total_time,
            "ttft_ms": ttft,
            "token_count": len(tokens),
        }
    except Exception as e:
        print(f"Error benchmarking RAG pipeline: {e}")
        results["rag"] = {"error": str(e)}
        
    return results


async def main():
    print("==================================================")
    print("      SATYAM PROTOTYPE PERFORMANCE BENCHMARK     ")
    print("==================================================")
    
    s = get_settings()
    print(f"App Environment: {s.app_env}")
    print(f"Database Source: {s.database_url.split('@')[-1].split('/')[0]} (Cloud Neon)")
    print(f"Model Backend  : {s.model_backend}")
    print(f"Brain Engine   : {s.brain_engine}")
    print(f"SQL Engine     : {s.sql_engine}")
    print(f"Local Device   : {s.model_device}")
    
    # Run all benchmarks
    embedding_results = await benchmark_local_embeddings()
    reranker_results = await benchmark_local_reranker()
    db_results = await benchmark_database()
    llm_results = await benchmark_llm_api()
    pipeline_results = await benchmark_pipelines()
    
    final_results = {
        "metadata": {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "app_env": s.app_env,
            "database_host": s.database_url.split('@')[-1].split('/')[0],
            "model_backend": s.model_backend,
            "brain_engine": s.brain_engine,
            "sql_engine": s.sql_engine,
            "local_device": s.model_device,
            "demo_mode": s.demo_mode,
        },
        "embeddings_bge_m3": embedding_results,
        "reranker_bge_v2": reranker_results,
        "database": db_results,
        "llm_apis": llm_results,
        "pipelines_e2e": pipeline_results,
    }
    
    # Write raw results
    output_path = os.path.join(os.path.dirname(__file__), "benchmark_results.json")
    with open(output_path, "w") as f:
        json.dump(final_results, f, indent=2)
    print(f"\nSaved raw benchmark results to: {output_path}")


if __name__ == "__main__":
    asyncio.run(main())
