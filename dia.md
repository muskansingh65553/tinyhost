# WarpHost System Architecture

```mermaid
graph TB
    subgraph Client
        UI[User Interface]
        Upload[File Upload]
    end

    subgraph Server
        Validation[File Validation]
        Processing[File Processing]
        SubdomainGen[Subdomain Generation]
    end

    subgraph CloudflareIntegration
        CFPages[Cloudflare Pages]
        CFDeploy[Deployment Process]
        CFDNS[DNS Configuration]
        CFSSL[SSL Certification]
    end

    subgraph Storage
        FileStore[File Storage]
        DBRecords[Database Records]
    end

    %% Client Flow
    UI --> Upload
    Upload --> Validation

    %% Server Processing
    Validation --> Processing
    Processing --> SubdomainGen
    Processing --> FileStore

    %% Cloudflare Integration
    SubdomainGen --> CFPages
    FileStore --> CFDeploy
    CFPages --> CFDeploy
    CFDeploy --> CFDNS
    CFDNS --> CFSSL

    %% Database Updates
    CFDeploy --> DBRecords
    CFDNS --> DBRecords

    %% Deployment Status
    CFDeploy --> UI
    CFSSL --> UI

    classDef client fill:#e1f5fe,stroke:#01579b
    classDef server fill:#f3e5f5,stroke:#4a148c
    classDef cloudflare fill:#fff3e0,stroke:#e65100
    classDef storage fill:#e8f5e9,stroke:#1b5e20

    class UI,Upload client
    class Validation,Processing,SubdomainGen server
    class CFPages,CFDeploy,CFDNS,CFSSL cloudflare
    class FileStore,DBRecords storage
```

## Diagram Components

### Client Side
- **User Interface**: Main web interface for user interactions
- **File Upload**: Handles ZIP file uploads from users

### Server Processing
- **File Validation**: Checks file integrity and content
- **File Processing**: Extracts and prepares files for deployment
- **Subdomain Generation**: Creates unique subdomains

### Cloudflare Integration
- **Cloudflare Pages**: Manages Pages projects
- **Deployment Process**: Handles asset deployment
- **DNS Configuration**: Sets up CNAME records
- **SSL Certification**: Manages SSL certificates

### Storage
- **File Storage**: Temporary storage for uploaded files
- **Database Records**: Stores deployment information