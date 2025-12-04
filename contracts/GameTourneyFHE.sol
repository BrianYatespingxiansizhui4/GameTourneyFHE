// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract GameTourneyFHE is SepoliaConfig {
    struct EncryptedMatchData {
        uint256 id;
        euint32 encryptedPlayerStats;
        euint32 encryptedGameLog;
        euint32 encryptedPlayerId;
        uint256 timestamp;
    }
    
    struct DecryptedMatchData {
        string playerStats;
        string gameLog;
        string playerId;
        bool isVerified;
    }

    uint256 public matchCount;
    mapping(uint256 => EncryptedMatchData) public encryptedMatches;
    mapping(uint256 => DecryptedMatchData) public decryptedMatches;
    
    mapping(string => euint32) private encryptedPlayerStats;
    string[] private playerList;
    
    mapping(uint256 => uint256) private requestToMatchId;
    
    event MatchSubmitted(uint256 indexed id, uint256 timestamp);
    event VerificationRequested(uint256 indexed id);
    event MatchVerified(uint256 indexed id);
    
    modifier onlyPlayer(uint256 matchId) {
        _;
    }
    
    function submitEncryptedMatchData(
        euint32 encryptedPlayerStats,
        euint32 encryptedGameLog,
        euint32 encryptedPlayerId
    ) public {
        matchCount += 1;
        uint256 newId = matchCount;
        
        encryptedMatches[newId] = EncryptedMatchData({
            id: newId,
            encryptedPlayerStats: encryptedPlayerStats,
            encryptedGameLog: encryptedGameLog,
            encryptedPlayerId: encryptedPlayerId,
            timestamp: block.timestamp
        });
        
        decryptedMatches[newId] = DecryptedMatchData({
            playerStats: "",
            gameLog: "",
            playerId: "",
            isVerified: false
        });
        
        emit MatchSubmitted(newId, block.timestamp);
    }
    
    function requestAntiCheatVerification(uint256 matchId) public onlyPlayer(matchId) {
        EncryptedMatchData storage matchData = encryptedMatches[matchId];
        require(!decryptedMatches[matchId].isVerified, "Already verified");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(matchData.encryptedPlayerStats);
        ciphertexts[1] = FHE.toBytes32(matchData.encryptedGameLog);
        ciphertexts[2] = FHE.toBytes32(matchData.encryptedPlayerId);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.verifyMatch.selector);
        requestToMatchId[reqId] = matchId;
        
        emit VerificationRequested(matchId);
    }
    
    function verifyMatch(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 matchId = requestToMatchId[requestId];
        require(matchId != 0, "Invalid request");
        
        EncryptedMatchData storage eMatch = encryptedMatches[matchId];
        DecryptedMatchData storage dMatch = decryptedMatches[matchId];
        require(!dMatch.isVerified, "Already verified");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory playerStats, string memory gameLog, string memory playerId) = 
            abi.decode(cleartexts, (string, string, string));
        
        dMatch.playerStats = playerStats;
        dMatch.gameLog = gameLog;
        dMatch.playerId = playerId;
        dMatch.isVerified = true;
        
        if (FHE.isInitialized(encryptedPlayerStats[dMatch.playerId]) == false) {
            encryptedPlayerStats[dMatch.playerId] = FHE.asEuint32(0);
            playerList.push(dMatch.playerId);
        }
        encryptedPlayerStats[dMatch.playerId] = FHE.add(
            encryptedPlayerStats[dMatch.playerId], 
            FHE.asEuint32(1)
        );
        
        emit MatchVerified(matchId);
    }
    
    function getDecryptedMatchData(uint256 matchId) public view returns (
        string memory playerStats,
        string memory gameLog,
        string memory playerId,
        bool isVerified
    ) {
        DecryptedMatchData storage m = decryptedMatches[matchId];
        return (m.playerStats, m.gameLog, m.playerId, m.isVerified);
    }
    
    function getEncryptedPlayerStats(string memory playerId) public view returns (euint32) {
        return encryptedPlayerStats[playerId];
    }
    
    function requestPlayerStatsDecryption(string memory playerId) public {
        euint32 stats = encryptedPlayerStats[playerId];
        require(FHE.isInitialized(stats), "Player not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(stats);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptPlayerStats.selector);
        requestToMatchId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(playerId)));
    }
    
    function decryptPlayerStats(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 playerHash = requestToMatchId[requestId];
        string memory playerId = getPlayerFromHash(playerHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 stats = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getPlayerFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < playerList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(playerList[i]))) == hash) {
                return playerList[i];
            }
        }
        revert("Player not found");
    }
    
    function detectCheatingPatterns(
        uint256 matchId,
        string[] memory knownCheatPatterns
    ) public view returns (bool isSuspicious) {
        DecryptedMatchData storage matchData = decryptedMatches[matchId];
        require(matchData.isVerified, "Match not verified");
        
        for (uint256 i = 0; i < knownCheatPatterns.length; i++) {
            if (containsPattern(matchData.gameLog, knownCheatPatterns[i])) {
                return true;
            }
        }
        return false;
    }
    
    function containsPattern(
        string memory gameLog,
        string memory pattern
    ) private pure returns (bool) {
        // Simplified pattern detection
        // In real implementation, this would use proper pattern matching
        return keccak256(abi.encodePacked(gameLog)) == keccak256(abi.encodePacked(pattern));
    }
    
    function calculateTournamentRankings(
        uint256[] memory matchIds
    ) public view returns (string[] memory playerIds, uint256[] memory scores) {
        mapping(string => uint256) memory playerScores;
        uint256 uniquePlayers = 0;
        
        for (uint256 i = 0; i < matchIds.length; i++) {
            DecryptedMatchData storage matchData = decryptedMatches[matchIds[i]];
            if (matchData.isVerified) {
                if (playerScores[matchData.playerId] == 0) {
                    uniquePlayers++;
                }
                playerScores[matchData.playerId] += calculateMatchScore(matchData.playerStats);
            }
        }
        
        playerIds = new string[](uniquePlayers);
        scores = new uint256[](uniquePlayers);
        uint256 index = 0;
        
        for (uint256 i = 0; i < matchIds.length; i++) {
            DecryptedMatchData storage matchData = decryptedMatches[matchIds[i]];
            if (matchData.isVerified && playerScores[matchData.playerId] > 0) {
                playerIds[index] = matchData.playerId;
                scores[index] = playerScores[matchData.playerId];
                playerScores[matchData.playerId] = 0;
                index++;
            }
        }
        return (playerIds, scores);
    }
    
    function calculateMatchScore(
        string memory playerStats
    ) private pure returns (uint256 score) {
        // Simplified score calculation
        // In real implementation, this would parse and analyze player stats
        return 100;
    }
    
    function validateTournamentResult(
        uint256[] memory matchIds,
        string memory winnerId
    ) public view returns (bool isValid) {
        (string[] memory playerIds, uint256[] memory scores) = calculateTournamentRankings(matchIds);
        
        uint256 maxScore = 0;
        string memory expectedWinner = "";
        
        for (uint256 i = 0; i < playerIds.length; i++) {
            if (scores[i] > maxScore) {
                maxScore = scores[i];
                expectedWinner = playerIds[i];
            }
        }
        
        return keccak256(abi.encodePacked(expectedWinner)) == keccak256(abi.encodePacked(winnerId));
    }
}