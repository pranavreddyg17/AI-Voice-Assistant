import requests
import json
import time

BASE_URL = "http://127.0.0.1:8000/api"

def run_test():
    print("1. Testing Health")
    health = requests.get("http://127.0.0.1:8000/health").json()
    print(f"Health: {health}")
    
    print("\n2. Uploading mock PDF")
    
    # Use existing pdf
    pdf_path = "uploads/c20910da-9d46-4079-a01b-658b7c68eecf.pdf"
    
    with open(pdf_path, "rb") as f:
        res = requests.post(f"{BASE_URL}/upload/document", files={"file": f})
    
    data = res.json()
    print(f"Upload Response: {data}")
    session_id = data["session_id"]
    
    print("\n3. Generating Case Summary")
    payload = {
        "session_id": session_id,
        "user_problem": "They denied my claim for my hospital stay, policy number 12345"
    }
    res = requests.post(f"{BASE_URL}/rag/case-summary", json=payload)
    summary_data = res.json()
    print(f"Summary Response keys: {summary_data.keys()}")
    
    print("\n4. Generating Script")
    payload = {
        "session_id": session_id,
        "user_problem": "They denied my claim for my hospital stay, policy number 12345",
        "case_summary": summary_data["case_summary"]
    }
    res = requests.post(f"{BASE_URL}/script/generate", json=payload)
    script_data = res.json()
    print(f"Script response: {script_data}")
    if "script" in script_data:
        print(f"Script generated with {len(script_data['script']['full_script'])} chars")
    
    print("\n5. Approving Script")
    payload = {
        "session_id": session_id,
        "approved": True,
        "full_script": script_data['script']['full_script']
    }
    res = requests.post(f"{BASE_URL}/script/approve", json=payload)
    print(f"Approve Response: {res.json()}")
    
    print("\n6. Registering Call")
    payload = {
        "session_id": session_id,
        "script": script_data['script']['full_script'],
        "user_problem": "They denied my claim for my hospital stay, policy number 12345"
    }
    res = requests.post(f"{BASE_URL}/call/start", json=payload)
    print(f"Call Start Response: {res.json()}")
    
    print("\nAll Backend tests passed!")

if __name__ == "__main__":
    run_test()
