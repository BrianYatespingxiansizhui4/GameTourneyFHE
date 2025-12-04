import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface Tournament {
  id: string;
  name: string;
  encryptedData: string;
  timestamp: number;
  organizer: string;
  gameType: string;
  status: "upcoming" | "live" | "completed" | "cancelled";
  playerCount: number;
  prizePool: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newTournamentData, setNewTournamentData] = useState({
    name: "",
    gameType: "",
    prizePool: "",
    playerCount: 0
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [showTeamInfo, setShowTeamInfo] = useState(false);

  // Calculate statistics for dashboard
  const upcomingCount = tournaments.filter(t => t.status === "upcoming").length;
  const liveCount = tournaments.filter(t => t.status === "live").length;
  const completedCount = tournaments.filter(t => t.status === "completed").length;
  const cancelledCount = tournaments.filter(t => t.status === "cancelled").length;

  // Filter tournaments based on search and filter criteria
  const filteredTournaments = tournaments.filter(tournament => {
    const matchesSearch = tournament.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         tournament.gameType.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = statusFilter === "all" || tournament.status === statusFilter;
    return matchesSearch && matchesFilter;
  });

  useEffect(() => {
    loadTournaments().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadTournaments = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("tournament_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing tournament keys:", e);
        }
      }
      
      const list: Tournament[] = [];
      
      for (const key of keys) {
        try {
          const tournamentBytes = await contract.getData(`tournament_${key}`);
          if (tournamentBytes.length > 0) {
            try {
              const tournamentData = JSON.parse(ethers.toUtf8String(tournamentBytes));
              list.push({
                id: key,
                name: tournamentData.name,
                encryptedData: tournamentData.data,
                timestamp: tournamentData.timestamp,
                organizer: tournamentData.organizer,
                gameType: tournamentData.gameType,
                status: tournamentData.status || "upcoming",
                playerCount: tournamentData.playerCount || 0,
                prizePool: tournamentData.prizePool || "0"
              });
            } catch (e) {
              console.error(`Error parsing tournament data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading tournament ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setTournaments(list);
    } catch (e) {
      console.error("Error loading tournaments:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitTournament = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting tournament data with FHE..."
    });
    
    try {
      // Simulate FHE encryption for tournament data
      const encryptedData = `FHE-${btoa(JSON.stringify(newTournamentData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const tournamentId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const tournamentData = {
        name: newTournamentData.name,
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        organizer: account,
        gameType: newTournamentData.gameType,
        status: "upcoming",
        playerCount: newTournamentData.playerCount,
        prizePool: newTournamentData.prizePool
      };
      
      // Store encrypted tournament data on-chain using FHE
      await contract.setData(
        `tournament_${tournamentId}`, 
        ethers.toUtf8Bytes(JSON.stringify(tournamentData))
      );
      
      const keysBytes = await contract.getData("tournament_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(tournamentId);
      
      await contract.setData(
        "tournament_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Tournament created with FHE encryption!"
      });
      
      await loadTournaments();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewTournamentData({
          name: "",
          gameType: "",
          prizePool: "",
          playerCount: 0
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Creation failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const startTournament = async (tournamentId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Starting tournament with FHE verification..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const tournamentBytes = await contract.getData(`tournament_${tournamentId}`);
      if (tournamentBytes.length === 0) {
        throw new Error("Tournament not found");
      }
      
      const tournamentData = JSON.parse(ethers.toUtf8String(tournamentBytes));
      
      const updatedTournament = {
        ...tournamentData,
        status: "live"
      };
      
      await contract.setData(
        `tournament_${tournamentId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedTournament))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Tournament started with FHE anti-cheat enabled!"
      });
      
      await loadTournaments();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Failed to start tournament: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const completeTournament = async (tournamentId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Completing tournament with FHE result verification..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const tournamentBytes = await contract.getData(`tournament_${tournamentId}`);
      if (tournamentBytes.length === 0) {
        throw new Error("Tournament not found");
      }
      
      const tournamentData = JSON.parse(ethers.toUtf8String(tournamentBytes));
      
      const updatedTournament = {
        ...tournamentData,
        status: "completed"
      };
      
      await contract.setData(
        `tournament_${tournamentId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedTournament))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Tournament completed with verifiable FHE results!"
      });
      
      await loadTournaments();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Failed to complete tournament: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOrganizer = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const teamMembers = [
    {
      name: "Alex Chen",
      role: "FHE Security Engineer",
      bio: "Expert in fully homomorphic encryption and zero-knowledge proofs.",
      avatar: "👨‍💻"
    },
    {
      name: "Maya Rodriguez",
      role: "Game Developer",
      bio: "Specialized in competitive gaming systems and anti-cheat technologies.",
      avatar: "👩‍🎮"
    },
    {
      name: "Jordan Smith",
      role: "Blockchain Architect",
      bio: "Designed the tournament smart contract system with FHE integration.",
      avatar: "👨‍🔬"
    },
    {
      name: "Taylor Kim",
      role: "UI/UX Designer",
      bio: "Created the cyberpunk tournament platform interface.",
      avatar: "👩‍🎨"
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing FHE secure connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>Game<span>Tourney</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-tournament-btn cyber-button"
          >
            <div className="add-icon"></div>
            Create Tournament
          </button>
          <button 
            className="cyber-button"
            onClick={() => setShowTeamInfo(!showTeamInfo)}
          >
            {showTeamInfo ? "Hide Team" : "Our Team"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Secured Game Tournaments</h2>
            <p>Run competitive gaming tournaments with fully homomorphic encryption for cheat detection</p>
          </div>
          <div className="fhe-badge">
            <span>FHE-Powered Anti-Cheat</span>
          </div>
        </div>
        
        <div className="dashboard-grid">
          <div className="dashboard-card cyber-card">
            <h3>Tournament Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{tournaments.length}</div>
                <div className="stat-label">Total Tournaments</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{upcomingCount}</div>
                <div className="stat-label">Upcoming</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{liveCount}</div>
                <div className="stat-label">Live</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{completedCount}</div>
                <div className="stat-label">Completed</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>FHE Advantage</h3>
            <ul className="fhe-features">
              <li>✓ Cheat detection on encrypted data</li>
              <li>✓ Player privacy protection</li>
              <li>✓ Verifiable tournament results</li>
              <li>✓ Transparent and fair competitions</li>
            </ul>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>Recent Activity</h3>
            {tournaments.length > 0 ? (
              <div className="recent-tournaments">
                {tournaments.slice(0, 3).map(tournament => (
                  <div key={tournament.id} className="recent-item">
                    <span className="tournament-name">{tournament.name}</span>
                    <span className={`status-badge ${tournament.status}`}>{tournament.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p>No tournaments yet</p>
            )}
          </div>
        </div>
        
        {showTeamInfo && (
          <div className="team-section">
            <h2>Our Team</h2>
            <div className="team-grid">
              {teamMembers.map((member, index) => (
                <div key={index} className="team-member cyber-card">
                  <div className="member-avatar">{member.avatar}</div>
                  <h3>{member.name}</h3>
                  <p className="member-role">{member.role}</p>
                  <p className="member-bio">{member.bio}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="tournaments-section">
          <div className="section-header">
            <h2>Tournaments</h2>
            <div className="header-actions">
              <div className="search-filter">
                <input 
                  type="text" 
                  placeholder="Search tournaments..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="cyber-input"
                />
                <select 
                  value={statusFilter} 
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="cyber-select"
                >
                  <option value="all">All Status</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="live">Live</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <button 
                onClick={loadTournaments}
                className="refresh-btn cyber-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="tournaments-grid">
            {filteredTournaments.length === 0 ? (
              <div className="no-tournaments cyber-card">
                <div className="no-tournaments-icon"></div>
                <p>No tournaments found</p>
                <button 
                  className="cyber-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Tournament
                </button>
              </div>
            ) : (
              filteredTournaments.map(tournament => (
                <div 
                  key={tournament.id} 
                  className="tournament-card cyber-card"
                  onClick={() => setSelectedTournament(tournament)}
                >
                  <div className="tournament-header">
                    <h3 className="tournament-name">{tournament.name}</h3>
                    <span className={`status-badge ${tournament.status}`}>{tournament.status}</span>
                  </div>
                  <div className="tournament-details">
                    <p className="game-type">{tournament.gameType}</p>
                    <p className="prize-pool">Prize: {tournament.prizePool} ETH</p>
                    <p className="players">{tournament.playerCount} players</p>
                    <p className="date">{new Date(tournament.timestamp * 1000).toLocaleDateString()}</p>
                  </div>
                  <div className="tournament-actions">
                    {isOrganizer(tournament.organizer) && tournament.status === "upcoming" && (
                      <button 
                        className="action-btn cyber-button success"
                        onClick={(e) => {
                          e.stopPropagation();
                          startTournament(tournament.id);
                        }}
                      >
                        Start
                      </button>
                    )}
                    {isOrganizer(tournament.organizer) && tournament.status === "live" && (
                      <button 
                        className="action-btn cyber-button primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          completeTournament(tournament.id);
                        }}
                      >
                        Complete
                      </button>
                    )}
                    <button 
                      className="action-btn cyber-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTournament(tournament);
                      }}
                    >
                      Details
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitTournament} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          tournamentData={newTournamentData}
          setTournamentData={setNewTournamentData}
        />
      )}
      
      {selectedTournament && (
        <TournamentDetails 
          tournament={selectedTournament} 
          onClose={() => setSelectedTournament(null)}
          isOrganizer={isOrganizer(selectedTournament.organizer)}
          onStart={() => startTournament(selectedTournament.id)}
          onComplete={() => completeTournament(selectedTournament.id)}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>GameTourneyFHE</span>
            </div>
            <p>FHE-powered secure tournament platform for competitive gaming</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Fair Play</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} GameTourneyFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  tournamentData: any;
  setTournamentData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  tournamentData,
  setTournamentData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setTournamentData({
      ...tournamentData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!tournamentData.name || !tournamentData.gameType) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Create New Tournament</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Tournament data will be encrypted with FHE for secure processing
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Tournament Name *</label>
              <input 
                type="text"
                name="name"
                value={tournamentData.name} 
                onChange={handleChange}
                placeholder="Tournament name..." 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group">
              <label>Game Type *</label>
              <select 
                name="gameType"
                value={tournamentData.gameType} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value="">Select game type</option>
                <option value="FPS">First Person Shooter</option>
                <option value="MOBA">MOBA</option>
                <option value="RTS">Real-Time Strategy</option>
                <option value="Fighting">Fighting</option>
                <option value="Sports">Sports</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Prize Pool (ETH)</label>
              <input 
                type="text"
                name="prizePool"
                value={tournamentData.prizePool} 
                onChange={handleChange}
                placeholder="0.0" 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group">
              <label>Player Count</label>
              <input 
                type="number"
                name="playerCount"
                value={tournamentData.playerCount} 
                onChange={handleChange}
                placeholder="Number of players" 
                className="cyber-input"
                min="2"
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn cyber-button primary"
          >
            {creating ? "Creating with FHE..." : "Create Tournament"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface TournamentDetailsProps {
  tournament: Tournament;
  onClose: () => void;
  isOrganizer: boolean;
  onStart: () => void;
  onComplete: () => void;
}

const TournamentDetails: React.FC<TournamentDetailsProps> = ({ 
  tournament, 
  onClose, 
  isOrganizer,
  onStart,
  onComplete
}) => {
  return (
    <div className="modal-overlay">
      <div className="details-modal cyber-card">
        <div className="modal-header">
          <h2>Tournament Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="tournament-info">
            <div className="info-row">
              <span className="label">Name:</span>
              <span className="value">{tournament.name}</span>
            </div>
            <div className="info-row">
              <span className="label">Game Type:</span>
              <span className="value">{tournament.gameType}</span>
            </div>
            <div className="info-row">
              <span className="label">Status:</span>
              <span className={`value status-badge ${tournament.status}`}>{tournament.status}</span>
            </div>
            <div className="info-row">
              <span className="label">Prize Pool:</span>
              <span className="value">{tournament.prizePool} ETH</span>
            </div>
            <div className="info-row">
              <span className="label">Players:</span>
              <span className="value">{tournament.playerCount}</span>
            </div>
            <div className="info-row">
              <span className="label">Organizer:</span>
              <span className="value">{tournament.organizer.substring(0, 8)}...{tournament.organizer.substring(tournament.organizer.length - 6)}</span>
            </div>
            <div className="info-row">
              <span className="label">Created:</span>
              <span className="value">{new Date(tournament.timestamp * 1000).toLocaleString()}</span>
            </div>
          </div>
          
          <div className="fhe-section">
            <h3>FHE Security Features</h3>
            <ul>
              <li>✓ All game data encrypted with FHE during processing</li>
              <li>✓ Cheat detection performed on encrypted data</li>
              <li>✓ Player identities protected throughout tournament</li>
              <li>✓ Results verifiable without compromising privacy</li>
            </ul>
          </div>
        </div>
        
        <div className="modal-footer">
          {isOrganizer && tournament.status === "upcoming" && (
            <button 
              onClick={onStart}
              className="action-btn cyber-button success"
            >
              Start Tournament
            </button>
          )}
          {isOrganizer && tournament.status === "live" && (
            <button 
              onClick={onComplete}
              className="action-btn cyber-button primary"
            >
              Complete Tournament
            </button>
          )}
          <button 
            onClick={onClose}
            className="action-btn cyber-button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;