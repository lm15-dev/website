for connection in auth.connections():
    status = auth.status(connection.provider)
    print(connection.label)
    print("   ", status.usability, "until", status.expires_at)
