import sys
print("Python:", sys.version)
try:
    from FlagEmbedding import BGEM3FlagModel
    print("FlagEmbedding imported OK")
    m = BGEM3FlagModel("models/bge-m3", use_fp16=True)
    print("Model loaded OK")
    out = m.encode(["test theft case"], return_dense=True, return_sparse=False, return_colbert_vecs=False)
    print("Encoded OK, dim:", len(out["dense_vecs"][0]))
except Exception as e:
    print("ERROR:", type(e).__name__, e)
    import traceback; traceback.print_exc()
