async function migrateDAO({ web3, spinner, confirm, opts, migrationParams, logTx, previousMigration: { base } }) {
	if (!(await confirm('About to migrate new DAO. Continue?'))) {
		return;
	}

	if (!base) {
		const msg = `Couldn't find existing base migration ('migration.json' > 'base').`;
		spinner.fail(msg);
		throw new Error(msg);
	}

	spinner.start('Migrating DAO...');
	let tx;

	const {
		DAOToken,
		UController,
		DaoCreator,
		SchemeRegistrar,
		GlobalConstraintRegistrar,
		UpgradeScheme,
		ContributionReward,
		GenesisProtocol,
		AbsoluteVote,
	} = base;

	const daoCreator = new web3.eth.Contract(
		require('@daostack/arc/build/contracts/DaoCreator.json').abi,
		DaoCreator,
		opts
	);
	const daoToken = new web3.eth.Contract(require('@daostack/arc/build/contracts/DAOToken.json').abi, DAOToken, opts);
	const schemeRegistrar = new web3.eth.Contract(
		require('@daostack/arc/build/contracts/SchemeRegistrar.json').abi,
		SchemeRegistrar,
		opts
	);
	const globalConstraintRegistrar = new web3.eth.Contract(
		require('@daostack/arc/build/contracts/GlobalConstraintRegistrar.json').abi,
		GlobalConstraintRegistrar,
		opts
	);
	const upgradeScheme = new web3.eth.Contract(
		require('@daostack/arc/build/contracts/UpgradeScheme.json').abi,
		UpgradeScheme,
		opts
	);
	const contributionReward = new web3.eth.Contract(
		require('@daostack/arc/build/contracts/ContributionReward.json').abi,
		ContributionReward,
		opts
	);
	const genesisProtocol = new web3.eth.Contract(
		require('@daostack/arc/build/contracts/GenesisProtocol.json').abi,
		GenesisProtocol,
		opts
	);
	const absoluteVote = new web3.eth.Contract(
		require('@daostack/arc/build/contracts/AbsoluteVote.json').abi,
		AbsoluteVote,
		opts
	);

	migrationParams.founders = migrationParams.founders.map(x => ({
		...x,
		address: x.privateKey ? web3.eth.accounts.privateKeyToAccount(x.privateKey).address : x.address,
	}));

	const [orgName, tokenName, tokenSymbol, founderAddresses, tokenDist, repDist, uController, cap] = [
		'Genesis Test',
		'Genesis Test',
		'GDT',
		migrationParams.founders.map(({ address }) => address),
		migrationParams.founders.map(({ tokens }) => tokens),
		migrationParams.founders.map(({ reputation }) => reputation),
		UController,
		'0',
	];

	for (let i = 0; i < migrationParams.founders.length; i++) {
		const { address, eth, gen } = migrationParams.founders[i];
		spinner.start(`Sending ${eth}ETH to ${address}`);
		const ethTx = await web3.eth.sendTransaction({
			...opts,
			to: address,
			value: web3.utils.toWei(eth.toString(), 'ether'),
		});
		logTx(ethTx, `Sent ${eth}ETH to ${address}`);

		spinner.start(`Minting ${gen}GEN to ${address}`);
		const genTx = await daoToken.methods.mint(address, web3.utils.toWei(gen.toString(), 'ether')).send();
		logTx(genTx, `Minted ${gen}GEN to ${address}`);

		//update founder eth and gen balance
		migrationParams.founders[i].eth = Number(
			web3.utils.fromWei((await web3.eth.getBalance(address)).toString(), 'ether')
		);
		migrationParams.founders[i].gen = Number(
			web3.utils.fromWei((await daoToken.methods.balanceOf(address).call()).toString(), 'ether')
		);
	}

	spinner.start('Creating a new organization...');
	const forgeOrg = daoCreator.methods.forgeOrg(
		orgName,
		tokenName,
		tokenSymbol,
		founderAddresses,
		tokenDist,
		repDist,
		uController,
		cap
	);
	const Avatar = await forgeOrg.call();
	tx = await forgeOrg.send();
	await logTx(tx, 'Created new organization.');

	spinner.start(`Sending ${migrationParams.DAOEthBalance}ETH to new DAO`);
	const daoEthTx = await web3.eth.sendTransaction({
		...opts,
		to: Avatar,
		value: web3.utils.toWei(migrationParams.DAOEthBalance.toString(), 'ether'),
	});
	logTx(daoEthTx, `Sent ${migrationParams.DAOEthBalance}ETH to new DAO`);

	spinner.start(`Minting ${migrationParams.DAOGENBalance}GEN to new DAO`);
	const genTx = await daoToken.methods
		.mint(Avatar, web3.utils.toWei(migrationParams.DAOGENBalance.toString(), 'ether'))
		.send();
	logTx(genTx, `Minted ${migrationParams.DAOGENBalance}GEN to new DAO`);

	spinner.start('Setting AbsoluteVote parameters...');
	const absoluteVoteSetParams = absoluteVote.methods.setParameters(
		migrationParams.AbsoluteVote.votePerc,
		migrationParams.AbsoluteVote.ownerVote
	);
	const absoluteVoteParams = await absoluteVoteSetParams.call();
	tx = await absoluteVoteSetParams.send();
	await logTx(tx, 'AbsoluteVote parameters set.');

	spinner.start('Setting SchemeRegistrar parameters...');
	const schemeRegistrarSetParams = schemeRegistrar.methods.setParameters(
		absoluteVoteParams,
		absoluteVoteParams,
		AbsoluteVote
	);
	const schemeRegistrarParams = await schemeRegistrarSetParams.call();
	tx = await schemeRegistrarSetParams.send();
	await logTx(tx, 'SchemeRegistrar parameters set.');

	spinner.start('Setting GlobalConstraintRegistrar parameters...');
	const globalConstraintRegistrarSetParams = globalConstraintRegistrar.methods.setParameters(
		absoluteVoteParams,
		AbsoluteVote
	);
	const globalConstraintRegistrarParams = await globalConstraintRegistrarSetParams.call();
	tx = await globalConstraintRegistrarSetParams.send();
	await logTx(tx, 'GlobalConstraintRegistrar parameters set.');

	spinner.start('Setting UpgradeScheme parameters...');
	const upgradeSchemeSetParams = upgradeScheme.methods.setParameters(absoluteVoteParams, AbsoluteVote);
	const upgradeSchemeParams = await upgradeSchemeSetParams.call();
	tx = await upgradeSchemeSetParams.send();
	await logTx(tx, 'UpgradeScheme parameters set.');

	spinner.start('Setting GenesisProtocol parameters...');
	const genesisProtocolSetParams = genesisProtocol.methods.setParameters(
		[
			migrationParams.GenesisProtocol.preBoostedVoteRequiredPercentage,
			migrationParams.GenesisProtocol.preBoostedVotePeriodLimit,
			migrationParams.GenesisProtocol.boostedVotePeriodLimit,
			web3.utils.toWei(migrationParams.GenesisProtocol.thresholdConstAGWei.toString(), 'gwei'),
			migrationParams.GenesisProtocol.thresholdConstB,
			web3.utils.toWei(migrationParams.GenesisProtocol.minimumStakingFeeGWei.toString(), 'gwei'),
			migrationParams.GenesisProtocol.quietEndingPeriod,
			migrationParams.GenesisProtocol.proposingRepRewardConstA,
			migrationParams.GenesisProtocol.proposingRepRewardConstB,
			migrationParams.GenesisProtocol.stakerFeeRatioForVoters,
			migrationParams.GenesisProtocol.votersReputationLossRatio,
			migrationParams.GenesisProtocol.votersGainRepRatioFromLostRep,
			migrationParams.GenesisProtocol.daoBountyConst,
			web3.utils.toWei(migrationParams.GenesisProtocol.daoBountyLimitGWei.toString(), 'gwei'),
		],
		migrationParams.GenesisProtocol.voteOnBehalf
	);
	const genesisProtocolParams = await genesisProtocolSetParams.call();
	tx = await genesisProtocolSetParams.send();
	await logTx(tx, 'GenesisProtocol parameters set.');

	spinner.start("Setting 'ContributionReward' parameters...");
	const contributionRewardSetParams = contributionReward.methods.setParameters(
		web3.utils.toWei(migrationParams.ContributionReward.orgNativeTokenFeeGWei.toString(), 'gwei'),
		genesisProtocolParams,
		GenesisProtocol
	);
	const contributionRewardParams = await contributionRewardSetParams.call();
	tx = await contributionRewardSetParams.send();
	await logTx(tx, 'ContributionReward parameters set.');

	const schemes = [SchemeRegistrar, GlobalConstraintRegistrar, UpgradeScheme, ContributionReward];
	const params = [
		schemeRegistrarParams,
		globalConstraintRegistrarParams,
		upgradeSchemeParams,
		contributionRewardParams,
	];
	const permissions = [
		'0x0000001F' /* all permissions */,
		'0x00000004' /* manage global constraints */,
		'0x0000000A' /* manage schemes + upgrade controller */,
		'0x00000000' /* no permissions */,
	];

	spinner.start('Setting DAO schemes...');
	tx = await daoCreator.methods.setSchemes(Avatar, schemes, params, permissions).send();
	await logTx(tx, 'DAO schemes set.');

	const avatar = new web3.eth.Contract(require('@daostack/arc/build/contracts/Avatar.json').abi, Avatar, opts);

	const NativeToken = await avatar.methods.nativeToken().call();
	const NativeReputation = await avatar.methods.nativeReputation().call();
	const avatarEth = web3.utils.fromWei(await web3.eth.getBalance(Avatar), 'ether');
	const avatarGEN = web3.utils.fromWei(await daoToken.methods.balanceOf(Avatar).call(), 'ether');

	return {
		dao: {
			name: orgName,
			Avatar,
			NativeToken,
			NativeReputation,
			founders: migrationParams.founders,
			eth: Number(avatarEth),
			gen: Number(avatarGEN),
		},
	};
}

module.exports = migrateDAO;
